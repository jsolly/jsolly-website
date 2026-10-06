import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import {
	compileRoutes,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	readLegacyJson,
	routePath,
} from "../blogthedata-redirects.mjs";
import { fieldLines, fieldValues } from "../site-files.mjs";
import {
	fetchTransport,
	sampleRows,
	verifyCutover,
} from "../verify-blogthedata-cutover.mjs";

// The verifier runs against local stub servers only: one answers as the
// legacy project would (Vercel's own compiled routes over the real
// vercel.json, plus public/), one as Vercel's http → https upgrade in front
// of it, and one as jsolly.com. Nothing here reaches the network.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-blogthedata-cutover.mjs");
const PUBLIC_DIR = join(LEGACY_DIR, "public");
const JSOLLY_SECURITY_TXT = join(ROOT, "public", ".well-known", "security.txt");
const BYPASS_ENV = "VERIFY_CUTOVER_TEST_BYPASS";
const BYPASS_SECRET = "stub-bypass-secret";
const DAY_MS = 86_400_000;
const DESTINATIONS_PASSED =
	/✓ destination 200: (?<passed>\d+) of \k<passed> passed/u;
const STATUS_308 = /^status 308, not 301/u;
const STATUS_301 = /^status 301, not 308/u;
const BODY_DIFFERS = /body differs from the repo file/u;
const EXPIRES_SOON = /is within 30 days/u;
const WRONG_FEED_TYPE = /Content-Type text\/xml, not application\/rss\+xml/u;
const STATIC_TYPES = {
	".html": "text/html; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};
const FEED_TYPES = {
	"/blog/rss.xml": "application/rss+xml; charset=utf-8",
	"/blog/atom.xml": "application/atom+xml; charset=utf-8",
};
const SAMPLE_IDS = [
	"PST-002",
	"CAT-001",
	"RCP-001",
	"FED-002",
	"SWK-001",
	"SWK-002",
	"PST-108",
	"SEC-002",
];

const map = readLegacyJson("url-map.json");
const union = readLegacyJson("url-union.json");
const routes = compileRoutes(readLegacyJson("vercel.json"));
const rowsById = new Map(map.rows.map((row) => [row.id, row]));
const served = new Map(
	map.rows
		.filter((row) => row.action === "serve-200")
		.map((row) => [row.source, join(PUBLIC_DIR, row.source)]),
);
const destinations = new Set(
	map.rows
		.filter((row) => row.action === "redirect-301")
		.map((row) => row.destination.slice(JSOLLY_ORIGIN.length)),
);
const servedIndexForms = union.elements.filter(
	(element) =>
		element.kind === "path" &&
		element.served_today &&
		element.path.endsWith("index.html"),
).length;
// Both security.txt files expire on the same day; `now` is set against it so
// the tests do not depend on today's date.
const expires = Date.parse(
	fieldValues(
		fieldLines(
			readFileSync(join(PUBLIC_DIR, ".well-known", "security.txt"), "utf8"),
		).fields,
		"expires",
	)[0],
);

async function listen(handler) {
	const server = createServer(handler);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const close = (servers) =>
	Promise.all(
		servers.map(
			({ server }) => new Promise((resolve) => server.close(() => resolve())),
		),
	);

// The query is split off by hand: `new URL(req.url, base)` would read the
// double-slash probes as a host.
function splitUrl(raw) {
	const at = raw.indexOf("?");
	return at === -1
		? { path: decodeURIComponent(raw), query: "" }
		: {
				path: decodeURIComponent(raw.slice(0, at)),
				query: raw.slice(at + 1),
			};
}

// `faults` maps a path to the wrong answer a broken deployment would give.
async function stubs({ legacy = {}, upgrade = {}, jsolly = {} } = {}) {
	const legacyStub = await listen((req, res) => {
		const { path, query } = splitUrl(req.url);
		if (legacy[path]) {
			return legacy[path](res, query);
		}
		const { redirect, headers } = routePath(routes, path);
		if (redirect) {
			// Vercel appends the request's query to a redirect destination.
			res.writeHead(redirect.status, {
				location: query ? `${redirect.location}?${query}` : redirect.location,
			});
			return res.end();
		}
		const file = served.get(path);
		if (file) {
			res.writeHead(200, {
				"content-type": headers["Content-Type"] ?? STATIC_TYPES[extname(file)],
				...(headers["Cache-Control"] && {
					"cache-control": headers["Cache-Control"],
				}),
			});
			return res.end(readFileSync(file));
		}
		res.writeHead(404, { "content-type": STATIC_TYPES[".html"] });
		return res.end(readFileSync(join(PUBLIC_DIR, "404.html")));
	});
	const upgradeStub = await listen((req, res) => {
		const { path } = splitUrl(req.url);
		if (upgrade[path]) {
			return upgrade[path](res);
		}
		res.writeHead(308, { location: `${legacyStub.origin}${req.url}` });
		return res.end();
	});
	const jsollyStub = await listen((req, res) => {
		const { path } = splitUrl(req.url);
		if (req.headers["x-vercel-protection-bypass"] !== BYPASS_SECRET) {
			res.writeHead(401);
			return res.end();
		}
		if (jsolly[path]) {
			return jsolly[path](res);
		}
		if (path === "/.well-known/security.txt") {
			res.writeHead(200, { "content-type": STATIC_TYPES[".txt"] });
			return res.end(readFileSync(JSOLLY_SECURITY_TXT));
		}
		if (destinations.has(path)) {
			res.writeHead(200, {
				"content-type": FEED_TYPES[path] ?? STATIC_TYPES[".html"],
			});
			return res.end("ok");
		}
		res.writeHead(404);
		return res.end();
	});
	return { legacyStub, upgradeStub, jsollyStub };
}

function verify({ legacyStub, upgradeStub, jsollyStub }, options) {
	return verifyCutover({
		targets: [{ origin: legacyStub.origin, upgradeOrigin: upgradeStub.origin }],
		request: fetchTransport(),
		destinationOrigin: jsollyStub.origin,
		destinationRequest: fetchTransport({
			"x-vercel-protection-bypass": BYPASS_SECRET,
		}),
		...options,
	});
}

// The CLI's --destinations-only run against a stub jsolly deployment, with
// the bypass secret passed by environment variable name.
function runCli(baseUrl) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				SCRIPT,
				"--destinations-only",
				"--base-url",
				baseUrl,
				"--bypass-env",
				BYPASS_ENV,
			],
			{
				cwd: ROOT,
				env: { ...process.env, [BYPASS_ENV]: BYPASS_SECRET },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("error", reject);
		child.on("close", (status) => resolve({ status, stdout }));
	});
}

const failures = ({ results }, labels) =>
	results
		.filter((result) => result.problem)
		.map(({ group, url }) => {
			const [origin, label] = Object.entries(labels).find(([prefix]) =>
				url.startsWith(prefix),
			);
			return `${group} ${label}${url.slice(origin.length)}`;
		})
		.sort();

it("A correct cutover passes every check, records the double slashes and keeps a fixed sample", async () => {
	const servers = await stubs();
	try {
		const now = expires - 60 * DAY_MS;
		const full = await verify(servers, { now });
		assert.deepEqual(
			full.results.filter((result) => result.problem),
			[],
		);
		const groups = new Set(full.results.map((result) => result.group));
		assert.deepEqual([...groups].sort(), [
			"301 redirect",
			"destination 200",
			"http upgrade",
			"lowercase 404",
			"query kept",
			"served 200",
			"stays 404",
		]);
		assert.equal(
			full.results.filter((result) => result.group === "destination 200")
				.length,
			destinations.size,
		);
		// Recorded, never failed: the stub (like an unrouted host) 404s them.
		const doubleSlash = full.records.filter((record) =>
			record.startsWith("double slash "),
		);
		assert.deepEqual(
			doubleSlash.map((record) => record.split(": ")[1]),
			["404", "404", "404"],
		);
		assert.ok(
			full.records.includes(
				`url-union.json: ${servedIndexForms} served index.html forms probed`,
			),
		);
		assert.ok(full.records.some((record) => record.startsWith("fragments: ")));

		assert.deepEqual(
			sampleRows(map).map((row) => row.id),
			SAMPLE_IDS,
		);
		const sample = await verify(servers, { now, sample: true });
		assert.deepEqual(
			sample.results.filter((result) => result.problem),
			[],
		);
		assert.ok(
			sample.results.some(
				(result) =>
					result.group === "security.txt" &&
					result.url ===
						`${servers.jsollyStub.origin}/.well-known/security.txt`,
			),
		);
		assert.ok(sample.results.length < full.results.length / 10);

		const cli = await runCli(servers.jsollyStub.origin);
		assert.equal(cli.status, 0, cli.stdout);
		assert.match(cli.stdout, DESTINATIONS_PASSED);
	} finally {
		await close(Object.values(servers));
	}
});

it("A broken cutover fails each wrong answer by name and exits non-zero", async () => {
	const row = (id) => rowsById.get(id);
	const answer =
		(status, headers = {}, body = "") =>
		(res) => {
			res.writeHead(status, headers);
			res.end(body);
		};
	const slashless = row("PST-003").source.slice(0, -1);
	const workerBytes = readFileSync(join(PUBLIC_DIR, row("SWK-002").source));
	const servers = await stubs({
		legacy: {
			// A redirect to the wrong page, also met by the first post's query probe.
			[row("PST-001").source]: answer(301, {
				location: `${JSOLLY_ORIGIN}/blog/`,
			}),
			// A chained hop instead of one 301.
			[slashless]: answer(308, { location: `${slashless}/` }),
			// A redirect that drops the query string.
			[row("SRH-001").source]: answer(301, {
				location: row("SRH-001").destination,
			}),
			// A kill-switch worker whose bytes changed.
			[row("SWK-002").source]: answer(
				200,
				{
					"content-type": "application/javascript; charset=utf-8",
					"cache-control": "no-cache",
				},
				Buffer.concat([workerBytes, Buffer.from("\n")]),
			),
			// A retired post that redirects instead of 404ing.
			[row("PST-109").source]: answer(301, {
				location: `${JSOLLY_ORIGIN}/blog/geoasteroids/`,
			}),
			// An odd double-slash answer is recorded, not failed.
			"//": answer(500),
		},
		// http that skips the 308 upgrade.
		upgrade: {
			[row("FED-002").source]: answer(301, {
				location: row("FED-002").destination,
			}),
		},
		jsolly: {
			"/blog/atom.xml": answer(404),
			"/blog/rss.xml": answer(200, { "content-type": "text/xml" }),
		},
	});
	try {
		// Within 30 days of the security.txt Expires.
		const now = expires - 10 * DAY_MS;
		const result = await verify(servers, { now });
		const labels = {
			[servers.legacyStub.origin]: "https:",
			[servers.upgradeStub.origin]: "http:",
			[servers.jsollyStub.origin]: "jsolly:",
		};
		assert.deepEqual(
			failures(result, labels),
			[
				`301 redirect https:${row("PST-001").source}`,
				`301 redirect https:${slashless}`,
				"destination 200 jsolly:/blog/atom.xml",
				"destination 200 jsolly:/blog/rss.xml",
				`http upgrade http:${row("FED-002").source}`,
				`http upgrade http:${row("PST-001").source}`,
				`http upgrade http:${row("PST-001").source}?utm_source=x`,
				`http upgrade http:${row("PST-109").source}`,
				`http upgrade http:${row("SEC-002").source}`,
				`http upgrade http:${row("SRH-001").source}?searched=django`,
				`http upgrade http:${row("SWK-002").source}`,
				`http upgrade http:${slashless}`,
				`query kept https:${row("PST-001").source}?utm_source=x`,
				`query kept https:${row("SRH-001").source}?searched=django`,
				`served 200 https:${row("SEC-002").source}`,
				`served 200 https:${row("SWK-002").source}`,
				`stays 404 https:${row("PST-109").source}`,
			].sort(),
		);
		const problems = Object.fromEntries(
			result.results
				.filter((check) => check.problem)
				.map((check) => [check.url, check.problem]),
		);
		const at = (origin, path) => problems[`${origin}${path}`];
		const { legacyStub, upgradeStub, jsollyStub } = servers;
		assert.match(at(legacyStub.origin, slashless), STATUS_308);
		assert.match(at(legacyStub.origin, row("SWK-002").source), BODY_DIFFERS);
		assert.match(at(legacyStub.origin, row("SEC-002").source), EXPIRES_SOON);
		assert.match(at(upgradeStub.origin, row("FED-002").source), STATUS_301);
		assert.match(at(jsollyStub.origin, "/blog/rss.xml"), WRONG_FEED_TYPE);
		assert.ok(
			result.records.includes(`double slash ${legacyStub.origin}//: 500`),
			result.records.join("\n"),
		);

		const cli = await runCli(jsollyStub.origin);
		assert.equal(cli.status, 1, cli.stdout);
		assert.match(
			cli.stdout,
			new RegExp(
				`✗ destination 200 ${jsollyStub.origin}/blog/atom\\.xml: status 404, not 200`,
				"u",
			),
		);
	} finally {
		await close(Object.values(servers));
	}
});
