import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { sourceToRegex } from "@vercel/routing-utils";
import {
	compileRoutes,
	isPageRow,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	readLegacyJson,
	routePath,
	SERVICE_WORKER_HEADERS,
	vercelConfig,
	vercelJsonDrift,
} from "../blogthedata-redirects.mjs";
import {
	fieldLines,
	fieldValues,
	headCommitDate,
	securityTxtProblems,
} from "../site-files.mjs";

// The URL map is the legacy host's whole behaviour: these tests route every
// known path through Vercel's own compiler and router library.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PUBLIC_DIR = join(LEGACY_DIR, "public");
const PUBLIC_TRACKED = "legacy/blogthedata/public";
const VERCEL_REDIRECT_LIMIT = 2048;
const UPPERCASE = /[A-Z]/u;
const FETCH_LISTENER = /addEventListener\(\s*["']fetch["']|\bonfetch\b/u;
const UNREGISTER = /\.registration\.unregister\(\)/u;
const CLAIM = /\.clients\.claim\(\)/u;
const CACHE_DELETE = /caches\.delete\(/u;
const DRIFT_IN_REDIRECTS = /differs .* in: redirects$/u;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu;
const SERVICE_WORKERS = [
	"recipe-service-worker.js",
	"post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js",
];
// Near-miss shapes that must stay 404: a page source never swallows a sibling
// file, a deeper path or an unlisted media file (review findings MU-1, MU-4).
const NEAR_MISSES = [
	"/post/conventional-commitsindex.html",
	"/post/conventional-commits/index.htm",
	"/post/conventional-commits/service-worker.js",
	"/post/conventional-commits/index.html/x",
	"/media/recipes/does-not-exist.webp",
	"/recipes-pwa/does-not-exist.png",
];
// Realistic hand edits of one url-map.json redirect row that generation must
// refuse, each with the guard's own message so no case passes on another's.
const BROKEN_MAP_EDITS = [
	{
		name: "unknown action",
		edit: (row) => {
			row.action = "redirect-308";
		},
		error: /unknown action redirect-308/u,
	},
	{
		name: "duplicate source",
		edit: (row, rows) => {
			rows.push({ ...row, id: "PST-999" });
		},
		error: /has two rows for/u,
	},
	{
		name: "`:slug` in an exact source",
		edit: (row) => {
			row.source = "/post/:slug/";
		},
		error: /is exact but its source \/post\/:slug\/ has pattern syntax/u,
	},
	{
		name: "off-origin destination",
		edit: (row) => {
			row.destination = "https://www.jsolly.com.evil.example/x";
		},
		error: /outside https:\/\/www\.jsolly\.com/u,
	},
	{
		name: "`$1` destination",
		edit: (row) => {
			row.destination = `${JSOLLY_ORIGIN}/blog/$1/`;
		},
		error: /has a parameter Vercel would interpolate/u,
	},
	{
		name: "`has` host condition",
		edit: (row) => {
			row.has = [{ type: "host", value: "blogthedata.com" }];
		},
		error: /carries a host condition/u,
	},
	{
		name: "pattern redirect",
		edit: (row) => {
			row.match = "pattern";
			row.source = "/post/:slug/";
		},
		error: /is a pattern redirect; redirects must be exact/u,
	},
];
// Paths served 200 today that deliberately become 404 (decision J27). These
// constants are the ledger's only home: the hashed /_astro files plus two others.
const ASTRO_ROW = "HSH-001";
const ASTRO_DROPPED = 55;
const OTHER_DROPPED = ["/release.json", "/search-index.json"];

const map = readLegacyJson("url-map.json");
const union = readLegacyJson("url-union.json");
const config = readLegacyJson("vercel.json");
const routes = compileRoutes(config);
const rowsById = new Map(map.rows.map((row) => [row.id, row]));
const rowsByAction = (action) =>
	map.rows.filter((row) => row.action === action);
const patternRegex = new Map(
	map.rows
		.filter((row) => row.match === "pattern")
		.map((row) => [row.id, new RegExp(sourceToRegex(row.source).src, "u")]),
);

// The forms one exact redirect row answers: a page also answers its
// slashless, /index.html and /index.html/ forms.
function redirectForms(row) {
	if (!isPageRow(row)) {
		return [row.source];
	}
	const base = row.source.slice(0, -1);
	return [row.source, base, `${base}/index.html`, `${base}/index.html/`];
}

// Mirrors the map's matching rule: exact page rows cover the slashless form,
// and redirect pages also cover /index.html and /index.html/.
function rowMatches(row, path) {
	if (row.match === "pattern") {
		return patternRegex.get(row.id).test(path);
	}
	if (row.action === "redirect-301") {
		return redirectForms(row).includes(path);
	}
	return (
		path === row.source || (isPageRow(row) && path === row.source.slice(0, -1))
	);
}

const escapeRegex = (text) => text.replaceAll(REGEX_SPECIAL, "\\$&");

// The only regex an exact row may compile to: a literal path, plus the
// optional /index.html and trailing slash of a page row.
function literalRouteSource(row) {
	if (!isPageRow(row)) {
		return `^${escapeRegex(row.source)}$`;
	}
	return `^${escapeRegex(row.source.slice(0, -1))}(?:/index\\.html)?(?:/)?$`;
}

function unredirected(paths) {
	return paths.filter((path) => routePath(routes, path).redirectHits > 0);
}

// What Vercel deploys from public/: the tracked files, so an untracked stray
// such as .DS_Store is not part of the served set.
function publicFiles() {
	const listed = spawnSync("git", ["ls-files", "-z", "--", PUBLIC_TRACKED], {
		cwd: ROOT,
		encoding: "utf8",
	});
	if (listed.status !== 0) {
		throw new Error(`git ls-files failed: ${listed.stderr}`);
	}
	return listed.stdout
		.split("\0")
		.filter((path) => path !== "")
		.map((path) => path.slice(PUBLIC_TRACKED.length));
}

// A one-row edit of the real map, as a hand edit of url-map.json would make.
function editedMap(edit) {
	const edited = structuredClone(map);
	const row = edited.rows.find(
		(candidate) => candidate.action === "redirect-301" && isPageRow(candidate),
	);
	edit(row, edited.rows);
	return edited;
}

it("Vercel compiles the legacy config within its redirect limit, every redirect a literal path", () => {
	const redirects = rowsByAction("redirect-301");
	assert.ok(redirects.length > 0);
	assert.ok(config.redirects.length <= VERCEL_REDIRECT_LIMIT);
	assert.equal(config.redirects.length, redirects.length);
	assert.equal(
		routes.length,
		config.redirects.length + config.headers.length,
		"one compiled route per redirect and header rule",
	);
	assert.equal(config.trailingSlash, undefined);
	assert.equal(config.outputDirectory, "public");
	assert.equal(config.framework, null);
	for (const redirect of config.redirects) {
		assert.deepEqual(Object.keys(redirect).sort(), [
			"destination",
			"source",
			"statusCode",
		]);
		assert.equal(redirect.statusCode, 301);
	}
	// Structural: every redirect compiles to a literal path, so no source can
	// become a pattern and no destination can interpolate, whether or not the
	// accident collides with a known path.
	const compiled = routes.filter((route) => route.status);
	assert.deepEqual(
		compiled.map((route) => [route.src, route.headers.Location]),
		redirects.map((row) => [literalRouteSource(row), row.destination]),
	);
});

it("A visitor to any form of an old URL gets one 301 to its jsolly.com page", () => {
	const failures = [];
	let forms = 0;
	for (const row of rowsByAction("redirect-301")) {
		for (const path of redirectForms(row)) {
			forms += 1;
			const { redirect, redirectHits } = routePath(routes, path);
			if (
				redirectHits !== 1 ||
				redirect?.status !== 301 ||
				redirect.location !== row.destination
			) {
				failures.push(
					`${path}: ${redirectHits} hit(s), got ${redirect?.location}`,
				);
			}
		}
	}
	for (const element of union.elements) {
		const row = rowsById.get(element.row_id);
		if (row?.action !== "redirect-301") {
			continue;
		}
		const { redirect } = routePath(routes, element.probe);
		if (redirect?.location !== row.destination) {
			failures.push(`known path ${element.probe}: got ${redirect?.location}`);
		}
	}
	assert.deepEqual(failures, []);
	assert.ok(forms > rowsByAction("redirect-301").length);
	assert.equal(
		map.rows.filter((row) => Object.hasOwn(row, "has")).length,
		0,
		"rows are host-agnostic",
	);
	assert.ok(
		map.rows
			.filter((row) => row.action === "redirect-301")
			.every((row) => row.destination.startsWith(`${JSOLLY_ORIGIN}/`)),
	);
});

it("The old host serves exactly its tracked public files, with no-cache headers on the kill-switch workers", () => {
	const served = rowsByAction("serve-200");
	assert.deepEqual(unredirected(served.map((row) => row.source)), []);
	for (const row of served) {
		assert.equal(row.destination, `legacy/blogthedata/public${row.source}`);
		assert.ok(existsSync(join(ROOT, row.destination)), row.destination);
	}
	assert.deepEqual(
		publicFiles().sort(),
		served.map((row) => row.source).sort(),
		"public/ serves exactly the serve-200 rows",
	);
	const expectedHeaders = Object.fromEntries(
		SERVICE_WORKER_HEADERS.map(({ key, value }) => [key, value]),
	);
	const workers = map.rows.filter((row) => row.class === "service-worker");
	assert.deepEqual(
		workers.map((row) => row.source.slice(1)).sort(),
		[...SERVICE_WORKERS].sort(),
	);
	for (const row of workers) {
		const { headers } = routePath(routes, row.source);
		assert.equal(headers["Content-Type"], expectedHeaders["Content-Type"]);
		assert.equal(headers["Cache-Control"], expectedHeaders["Cache-Control"]);
	}
	// Every served file keeps the old host's hardening, written out here rather
	// than imported, so dropping a header from the generator fails this test.
	for (const row of served) {
		const { headers } = routePath(routes, row.source);
		assert.equal(headers["X-Content-Type-Options"], "nosniff", row.source);
		assert.equal(headers["X-Frame-Options"], "DENY", row.source);
		assert.equal(
			headers["Referrer-Policy"],
			"strict-origin-when-cross-origin",
			row.source,
		);
		assert.equal(
			headers["Content-Security-Policy"],
			"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
			row.source,
		);
	}
});

it("Retired, unknown and near-miss old URLs get a 404, never a redirect", () => {
	const stays = rowsByAction("stays-404");
	assert.deepEqual(
		stays
			.filter((row) => row.match === "pattern" && !(row.samples?.length > 0))
			.map((row) => row.id),
		[],
		"every stays-404 pattern row carries samples",
	);
	const paths = stays.flatMap((row) => {
		if (row.match === "pattern") {
			return row.samples;
		}
		return isPageRow(row)
			? [row.source, row.source.slice(0, -1)]
			: [row.source];
	});
	assert.deepEqual(unredirected([...paths, ...NEAR_MISSES]), []);
	// Every known path whose row is not a redirect, routed directly.
	const knownUnredirected = union.elements
		.filter(
			(element) =>
				element.kind !== "host-rule" &&
				rowsById.get(element.row_id).action !== "redirect-301",
		)
		.map((element) => element.probe);
	assert.ok(knownUnredirected.length > 0);
	assert.deepEqual(unredirected(knownUnredirected), []);
});

it("A lowercased URL of a mixed-case old slug gets a 404, not a redirect", () => {
	const sources = new Set(map.rows.map((row) => row.source));
	const lowercase = rowsByAction("redirect-301")
		.filter((row) => UPPERCASE.test(row.source))
		.map((row) => row.source.toLowerCase())
		.filter((source) => !sources.has(source));
	assert.ok(lowercase.length > 0);
	assert.deepEqual(unredirected(lowercase), []);
});

it("Every known old URL has exactly one url-map row, and every row has a known URL", () => {
	// The old apex→www host rule is covered by every redirect being host-agnostic.
	const hostRules = union.elements.filter(
		(element) => element.kind === "host-rule",
	);
	assert.equal(hostRules.length, 1);
	assert.equal(
		config.redirects.filter((redirect) => "has" in redirect).length,
		0,
	);
	const problems = [];
	const matchedRows = new Set();
	for (const element of union.elements) {
		if (element.kind === "host-rule") {
			continue;
		}
		const hits = map.rows.filter((row) => rowMatches(row, element.probe));
		if (hits.length !== 1 || hits[0].id !== element.row_id) {
			problems.push(
				`${element.probe}: rows ${hits.map((row) => row.id).join(", ") || "none"}, recorded ${element.row_id}`,
			);
		}
		matchedRows.add(element.row_id);
	}
	assert.deepEqual(problems, []);
	assert.deepEqual(
		map.rows.filter((row) => !matchedRows.has(row.id)).map((row) => row.id),
		[],
		"a row with no known path has no evidence",
	);
});

it("Only the pinned ledger of URLs the old host serves today stops working", () => {
	const dropped = union.elements.filter(
		(element) =>
			element.served_today &&
			rowsById.get(element.row_id)?.action === "stays-404",
	);
	const astro = dropped.filter((element) => element.row_id === ASTRO_ROW);
	assert.equal(astro.length, ASTRO_DROPPED);
	assert.ok(astro.every((element) => element.path.startsWith("/_astro/")));
	assert.deepEqual(
		dropped
			.filter((element) => element.row_id !== ASTRO_ROW)
			.map((element) => element.path)
			.sort(),
		OTHER_DROPPED,
	);
});

it("The committed vercel.json is what url-map.json generates, so redirects:check passes", () => {
	const check = spawnSync(
		process.execPath,
		["scripts/blogthedata-redirects.mjs", "--check"],
		{ cwd: ROOT, encoding: "utf8" },
	);
	assert.equal(check.status, 0, check.stderr);
	assert.deepEqual(vercelConfig(map), config);
});

it("An edit to url-map.json without regenerating vercel.json fails the gate", () => {
	const dir = mkdtempSync(join(tmpdir(), "blogthedata-redirects-"));
	try {
		cpSync(join(LEGACY_DIR, "vercel.json"), join(dir, "vercel.json"));
		const edited = editedMap((row) => {
			row.destination = `${JSOLLY_ORIGIN}/blog/elsewhere/`;
		});
		writeFileSync(join(dir, "url-map.json"), JSON.stringify(edited));
		assert.match(vercelJsonDrift(dir) ?? "", DRIFT_IN_REDIRECTS);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("A broken url-map edit fails generation instead of shipping a bad redirect", () => {
	// The unedited map generates, so each failure below is the edit's.
	assert.doesNotThrow(() => vercelConfig(map));
	for (const { name, edit, error } of BROKEN_MAP_EDITS) {
		assert.throws(() => vercelConfig(editedMap(edit)), error, name);
	}
});

it("Crawlers on the old host get a robots.txt that allows following the 301s", () => {
	const { fields, unparsed } = fieldLines(
		readFileSync(join(PUBLIC_DIR, "robots.txt"), "utf8"),
	);
	assert.deepEqual(unparsed, [], "every robots.txt line is a directive");
	assert.deepEqual(fieldValues(fields, "user-agent"), ["*"]);
	assert.deepEqual(fieldValues(fields, "allow"), ["/"]);
	assert.deepEqual(fieldValues(fields, "disallow"), []);
});

it("Security researchers on the old host get a valid, unexpired security.txt", () => {
	// Any field beyond these and Expires fails, Encryption included:
	// public/pgp-key.txt expired on 2023-05-08.
	assert.deepEqual(
		securityTxtProblems(
			readFileSync(join(PUBLIC_DIR, ".well-known", "security.txt"), "utf8"),
			{
				contact: `${JSOLLY_ORIGIN}/contact/`,
				"preferred-languages": "en",
				canonical: "https://www.blogthedata.com/.well-known/security.txt",
			},
			{ committed: headCommitDate() },
		),
		[],
	);
});

it("Both old recipe worker URLs get one kill-switch that never handles fetches and retires itself", () => {
	const [root, legacy] = SERVICE_WORKERS.map((path) =>
		readFileSync(join(PUBLIC_DIR, path), "utf8"),
	);
	assert.equal(legacy, root);
	assert.doesNotMatch(root, FETCH_LISTENER);
	assert.match(root, CLAIM);
	assert.match(root, CACHE_DELETE);
	assert.match(root, UNREGISTER);
});
