import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import {
	compileRoutes,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	readLegacyJson,
	routePath,
	servedIndexForms,
} from "../blogthedata-redirects.mjs";
import { DAY_MS, fieldLines, securityTxtExpires } from "../site-files.mjs";
import {
	destinationsPlan,
	fetchTransport,
	fullPlan,
	GROUP,
	samplePlan,
	sampleRows,
	vercelCurlTransport,
	verifyCutover,
} from "../verify-blogthedata-cutover.mjs";

// The verifier runs against local stub servers only: one answers as the
// legacy project would (Vercel's own compiled routes over the real
// vercel.json, plus public/), one as Vercel's http → https upgrade in front
// of it, and one as jsolly.com. The vercel-curl transport runs a fake CLI.
// Nothing here reaches the network.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-blogthedata-cutover.mjs");
const PUBLIC_DIR = join(LEGACY_DIR, "public");
const LEGACY_SECURITY_TXT = join(PUBLIC_DIR, ".well-known", "security.txt");
const JSOLLY_SECURITY_TXT = join(ROOT, "public", ".well-known", "security.txt");
const BYPASS_ENV = "VERIFY_CUTOVER_TEST_BYPASS";
const BYPASS_SECRET = "stub-bypass-secret";
const EMPTY_ENV = "VERIFY_CUTOVER_TEST_EMPTY";
const DESTINATIONS_PASSED =
	/✓ destination 200: (?<passed>\d+) of \k<passed> passed/u;
const REQUEST_FAILED = /^request failed: /u;
const AFTER_308_REQUEST_FAILED = /^after the 308, request failed: /u;
const STATUS_308 = /^status 308, not 301/u;
const STATUS_301 = /^status 301, not 308/u;
const BODY_DIFFERS = /body differs from the repo file/u;
const EXPIRES_SOON = /is within 30 days/u;
const WRONG_FEED_TYPE = /Content-Type text\/xml, not application\/rss\+xml/u;
const EXPIRES_LINE = /^Expires: .*$/mu;
const UNREADABLE = /unreadable curl write-out/u;
const EXITED_28 = /vercel curl exited 28/u;
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
// Each flag combination outside the four modes, and its usage error.
const BAD_COMBINATIONS = [
	[[], "pass exactly one of --production and --base-url"],
	[["--destinations-only"], "pass exactly one of --production and --base-url"],
	[
		["--production", "--base-url", "https://stub.invalid"],
		"pass exactly one of --production and --base-url",
	],
	[
		["--production", "--destinations-only"],
		"--destinations-only needs --base-url, not --production",
	],
	[
		["--production", "--transport", "vercel-curl"],
		"--transport applies to --base-url only",
	],
	[
		["--production", "--bypass-env", BYPASS_ENV],
		"--bypass-env applies to --base-url only",
	],
	[
		["--base-url", "https://stub.invalid", "--sample"],
		"--sample runs with --production only",
	],
	[
		["--base-url", "https://stub.invalid", "--transport", "ftp"],
		"unknown --transport ftp",
	],
	[
		[
			"--base-url",
			"https://stub.invalid",
			"--transport",
			"vercel-curl",
			"--bypass-env",
			BYPASS_ENV,
		],
		"--bypass-env applies to the fetch transport only",
	],
	[
		["--base-url", "https://stub.invalid", "--bypass-env", EMPTY_ENV],
		`environment variable ${EMPTY_ENV} is empty`,
	],
	[
		["--base-url", "https://stub.invalid/blog/"],
		"must be an origin, with no path",
	],
	[["--base-url", "stub.invalid"], "must start with https://"],
	[["--base-url", "http://stub.invalid"], "must start with https://"],
];
// A fake `vercel` CLI: it logs each call next to itself, prints chatter
// before the write-out, writes a body to the -o path, and accepts a request
// without the bypass secret only for the -v warm-up, which prints it.
const FAKE_VERCEL = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null;
const warmUp = args.includes("-v");
appendFileSync(new URL("calls.jsonl", import.meta.url), JSON.stringify({ args, bypass }) + "\\n");
if (!warmUp && bypass !== "fake-token") {
	console.error("no bypass secret from the warm-up");
	process.exit(1);
}
const url = args[1];
process.stdout.write("Vercel CLI 59.17.0\\nchatter before the write-out\\n");
if (warmUp) {
	process.stderr.write("> GET / HTTP/2\\n> x-vercel-protection-bypass: fake-token\\n");
}
if (url.endsWith("/slow")) {
	console.error("curl: (28) Operation timed out");
	process.exit(28);
}
if (url.endsWith("/garbled")) {
	process.stdout.write("no write-out");
	process.exit(0);
}
const output = args[args.indexOf("-o") + 1];
if (output !== "/dev/null") {
	writeFileSync(output, "served bytes\\n");
}
const marker = "\\nverify-blogthedata-cutover\\n";
process.stdout.write(
	url.endsWith("/moved")
		? marker + "301\\nhttps://www.jsolly.com/moved/\\n\\n"
		: marker + "200\\n\\ntext/plain; charset=utf-8\\nno-cache",
);
`;

const map = readLegacyJson("url-map.json");
const union = readLegacyJson("url-union.json");
const routes = compileRoutes(readLegacyJson("vercel.json"));
const rowsById = new Map(map.rows.map((entry) => [entry.id, entry]));
const row = (id) => rowsById.get(id);
const served = new Map(
	map.rows
		.filter((candidate) => candidate.action === "serve-200")
		.map((candidate) => [candidate.source, join(PUBLIC_DIR, candidate.source)]),
);
const destinations = new Set(
	map.rows
		.filter((candidate) => candidate.action === "redirect-301")
		.map((candidate) => candidate.destination.slice(JSOLLY_ORIGIN.length)),
);
// Both security.txt files expire on the same day; `now` is set against it so
// the tests do not depend on today's date.
const expires = securityTxtExpires(
	fieldLines(readFileSync(LEGACY_SECURITY_TXT, "utf8")).fields,
).time;
const meals = row("RCP-012");

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

// An origin nothing listens on: a server's port, closed again.
async function closedOrigin() {
	const stub = await listen(() => undefined);
	await close([stub]);
	return stub.origin;
}

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

const answer =
	(status, headers = {}, body = "") =>
	(res) => {
		res.writeHead(status, headers);
		res.end(body);
	};

// /recipes/meals/ answering its query through `edit`, as Vercel would with
// the query appended.
const mealsWithQuery = (edit) => (res, query) => {
	res.writeHead(301, {
		location: query ? `${meals.destination}?${edit(query)}` : meals.destination,
	});
	res.end();
};

// `faults` maps a path to the wrong answer a broken deployment would give.
// The objects are read per request, so a test may swap an answer between runs.
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

// The CLI with `args`, its env carrying the bypass secret by name.
function runCli(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [SCRIPT, ...args], {
			cwd: ROOT,
			env: { ...process.env, [BYPASS_ENV]: BYPASS_SECRET, [EMPTY_ENV]: "" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (status) => resolve({ status, stdout, stderr }));
	});
}

const destinationsOnly = (origin) =>
	runCli([
		"--destinations-only",
		"--base-url",
		origin,
		"--bypass-env",
		BYPASS_ENV,
	]);

// The failed checks as `<group> <label><path>`, each origin named by `labels`.
const failures = ({ results }, labels) =>
	results
		.filter((result) => result.problem)
		.map(({ group, url }) => {
			const [origin, label] = Object.entries(labels).find(([prefix]) =>
				url.startsWith(`${prefix}/`),
			);
			return `${group} ${label}${url.slice(origin.length)}`;
		})
		.sort();

const problemOf = ({ results }, url) =>
	results.find((result) => result.url === url)?.problem;

it("A correct cutover passes every check, records the double slashes and keeps a fixed sample", async () => {
	const servers = await stubs({
		// Vercel may percent-encode the query's `:`; the parameters are the same.
		legacy: {
			[meals.source]: mealsWithQuery((query) => query.replaceAll(":", "%3A")),
		},
	});
	try {
		const now = expires - 60 * DAY_MS;
		const warnings = [];
		const full = await verify(servers, {
			plan: fullPlan(map, union),
			now,
			warn: (message) => warnings.push(message),
		});
		assert.deepEqual(
			full.results.filter((result) => result.problem),
			[],
		);
		assert.deepEqual(warnings, []);
		assert.deepEqual(
			[...new Set(full.results.map((result) => result.group))].sort(),
			Object.values(GROUP)
				.filter((group) => group !== GROUP.securityTxt)
				.sort(),
		);
		assert.equal(
			full.results.filter((result) => result.group === GROUP.destination)
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
				`url-union.json: ${servedIndexForms(union).length} served index.html forms probed`,
			),
		);
		assert.ok(full.records.some((record) => record.startsWith("fragments: ")));

		assert.deepEqual(
			sampleRows(map).map((sampled) => sampled.id),
			SAMPLE_IDS,
		);
		const sample = await verify(servers, { plan: samplePlan(map), now });
		assert.deepEqual(
			sample.results.filter((result) => result.problem),
			[],
		);
		assert.ok(
			sample.results.some(
				(result) =>
					result.group === GROUP.securityTxt &&
					result.url ===
						`${servers.jsollyStub.origin}/.well-known/security.txt`,
			),
		);
		assert.ok(sample.results.length < full.results.length / 10);

		const cli = await destinationsOnly(servers.jsollyStub.origin);
		assert.equal(cli.status, 0, cli.stdout + cli.stderr);
		assert.match(cli.stdout, DESTINATIONS_PASSED);
	} finally {
		await close(Object.values(servers));
	}
});

it("A broken cutover fails each wrong answer by name and exits non-zero", async () => {
	const slashless = row("PST-003").source.slice(0, -1);
	const workerBytes = readFileSync(join(PUBLIC_DIR, row("SWK-002").source));
	let resets = 0;
	const jsolly = {
		"/blog/atom.xml": answer(404),
		"/blog/rss.xml": answer(200, { "content-type": "text/xml" }),
	};
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
			// A redirect that adds a parameter.
			[meals.source]: mealsWithQuery((query) => `${query}&extra=1`),
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
			// A connection reset on every attempt.
			"/404.html": (res) => {
				resets += 1;
				res.socket.destroy();
			},
			// An odd double-slash answer is recorded, not failed.
			"//": answer(500),
		},
		// http that skips the 308 upgrade.
		upgrade: {
			[row("FED-002").source]: answer(301, {
				location: row("FED-002").destination,
			}),
		},
		jsolly,
	});
	try {
		const { legacyStub, upgradeStub, jsollyStub } = servers;
		const closed = await closedOrigin();
		const labels = {
			[legacyStub.origin]: "https:",
			[upgradeStub.origin]: "http:",
			[jsollyStub.origin]: "jsolly:",
			[closed]: "closed:",
		};
		const warnings = [];
		const warn = (message) => warnings.push(message);
		// Within 30 days of the security.txt Expires.
		const now = expires - 10 * DAY_MS;
		const result = await verify(servers, {
			plan: fullPlan(map, union),
			now,
			warn,
		});
		assert.deepEqual(
			failures(result, labels),
			[
				`301 redirect https:${row("PST-001").source}`,
				`301 redirect https:${slashless}`,
				"destination 200 jsolly:/blog/atom.xml",
				"destination 200 jsolly:/blog/rss.xml",
				"http upgrade http:/404.html",
				`http upgrade http:${row("FED-002").source}`,
				`http upgrade http:${row("PST-001").source}`,
				`http upgrade http:${row("PST-001").source}?utm_source=x`,
				`http upgrade http:${row("PST-109").source}`,
				`http upgrade http:${row("SEC-002").source}`,
				`http upgrade http:${row("SRH-001").source}?searched=django`,
				`http upgrade http:${row("SWK-002").source}`,
				`http upgrade http:${meals.source}?servings=6&starch=a:b`,
				`http upgrade http:${slashless}`,
				`query kept https:${row("PST-001").source}?utm_source=x`,
				`query kept https:${row("SRH-001").source}?searched=django`,
				`query kept https:${meals.source}?servings=6&starch=a:b`,
				"served 200 https:/404.html",
				`served 200 https:${row("SEC-002").source}`,
				`served 200 https:${row("SWK-002").source}`,
				`stays 404 https:${row("PST-109").source}`,
			].sort(),
		);
		const at = (origin, path) => problemOf(result, `${origin}${path}`);
		assert.match(at(legacyStub.origin, "/404.html"), REQUEST_FAILED);
		assert.match(at(upgradeStub.origin, "/404.html"), AFTER_308_REQUEST_FAILED);
		// Two checks reach /404.html (https, and http after its 308), and each
		// retries a reset exactly once.
		assert.equal(resets, 4);
		assert.equal(
			warnings.filter((message) => message.includes("/404.html")).length,
			2,
		);
		assert.match(at(legacyStub.origin, slashless), STATUS_308);
		assert.match(at(legacyStub.origin, row("SWK-002").source), BODY_DIFFERS);
		assert.match(at(legacyStub.origin, row("SEC-002").source), EXPIRES_SOON);
		assert.match(at(upgradeStub.origin, row("FED-002").source), STATUS_301);
		assert.match(at(jsollyStub.origin, "/blog/rss.xml"), WRONG_FEED_TYPE);
		assert.ok(
			result.records.includes(`double slash ${legacyStub.origin}//: 500`),
			result.records.join("\n"),
		);

		// A probe aimed at a closed port fails after one retry.
		const destinationsPlanned = destinationsPlan(map);
		const refused = await verifyCutover({
			plan: {
				...destinationsPlanned,
				destinations: destinationsPlanned.destinations.slice(0, 1),
			},
			targets: [],
			request: fetchTransport(),
			destinationOrigin: closed,
			destinationRequest: fetchTransport(),
			warn,
		});
		const refusedPath = destinationsPlanned.destinations[0].path;
		assert.deepEqual(failures(refused, labels), [
			`destination 200 closed:${refusedPath}`,
		]);
		assert.match(problemOf(refused, `${closed}${refusedPath}`), REQUEST_FAILED);
		assert.equal(
			warnings.filter((message) => message.includes(closed)).length,
			1,
		);

		// The daily sample reports the faulty sampled rows, and jsolly.com's
		// security.txt when its bytes change or it nears expiry.
		jsolly["/.well-known/security.txt"] = answer(
			200,
			{ "content-type": STATIC_TYPES[".txt"] },
			`${readFileSync(JSOLLY_SECURITY_TXT, "utf8")}# changed\n`,
		);
		const later = expires - 60 * DAY_MS;
		const sample = await verify(servers, { plan: samplePlan(map), now: later });
		assert.deepEqual(
			failures(sample, labels),
			[
				"destination 200 jsolly:/blog/rss.xml",
				`http upgrade http:${row("FED-002").source}`,
				`http upgrade http:${row("SWK-002").source}`,
				`served 200 https:${row("SWK-002").source}`,
				"security.txt jsolly:/.well-known/security.txt",
			].sort(),
		);
		assert.match(
			problemOf(sample, `${jsollyStub.origin}/.well-known/security.txt`),
			BODY_DIFFERS,
		);
		jsolly["/.well-known/security.txt"] = answer(
			200,
			{ "content-type": STATIC_TYPES[".txt"] },
			readFileSync(JSOLLY_SECURITY_TXT, "utf8").replace(
				EXPIRES_LINE,
				`Expires: ${new Date(later + 10 * DAY_MS).toISOString()}`,
			),
		);
		const expiring = await verify(servers, {
			plan: samplePlan(map),
			now: later,
		});
		assert.match(
			problemOf(expiring, `${jsollyStub.origin}/.well-known/security.txt`),
			EXPIRES_SOON,
		);

		const cli = await destinationsOnly(jsollyStub.origin);
		assert.equal(cli.status, 1, cli.stdout + cli.stderr);
		assert.ok(
			cli.stdout.includes(
				`✗ destination 200 ${jsollyStub.origin}/blog/atom.xml: status 404, not 200`,
			),
			cli.stdout,
		);
	} finally {
		await close(Object.values(servers));
	}
});

it("Any flag combination outside the four modes is a usage error", async () => {
	const runs = await Promise.all(
		BAD_COMBINATIONS.map(([args]) => runCli(args)),
	);
	BAD_COMBINATIONS.forEach(([args, message], index) => {
		const { status, stdout, stderr } = runs[index];
		assert.equal(status, 2, args.join(" "));
		assert.equal(stdout, "", args.join(" "));
		assert.ok(stderr.includes(message), `${args.join(" ")}: ${stderr}`);
	});
});

it("The vercel-curl transport warms up once, then reads each answer past the CLI's chatter", async () => {
	const dir = mkdtempSync(join(tmpdir(), "verify-cutover-vercel-"));
	try {
		const bin = join(dir, "vercel.mjs");
		writeFileSync(bin, FAKE_VERCEL);
		chmodSync(bin, 0o755);
		const scratch = join(dir, "scratch");
		const origin = "https://stub.invalid";
		const request = await vercelCurlTransport(
			bin,
			origin,
			mkdtempSync(scratch),
		);
		assert.deepEqual(await request(`${origin}/robots.txt`, { body: true }), {
			status: 200,
			location: null,
			contentType: "text/plain; charset=utf-8",
			cacheControl: "no-cache",
			body: Buffer.from("served bytes\n"),
		});
		assert.deepEqual(await request(`${origin}/moved`, { body: false }), {
			status: 301,
			location: "https://www.jsolly.com/moved/",
			contentType: null,
			cacheControl: null,
		});
		await assert.rejects(
			request(`${origin}/garbled`, { body: false }),
			(error) => {
				assert.match(error.message, UNREADABLE);
				assert.ok(!error.transient, "an unreadable write-out is not retried");
				return true;
			},
		);
		await assert.rejects(
			request(`${origin}/slow`, { body: false }),
			(error) => {
				assert.match(error.message, EXITED_28);
				assert.equal(error.transient, true);
				return true;
			},
		);

		const calls = readFileSync(join(dir, "calls.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const [warmUp, ...probes] = calls;
		assert.equal(warmUp.args[1], `${origin}/`);
		assert.ok(warmUp.args.includes("-v"));
		assert.equal(probes.length, 4);
		for (const { args } of calls) {
			assert.deepEqual(args.slice(0, 1), ["curl"]);
			assert.deepEqual(args.slice(2, 4), ["--scope", "jsollys-projects"]);
			assert.equal(args[4], "--cwd");
			assert.ok(args[5].startsWith(dir));
			assert.equal(args[6], "--");
			assert.deepEqual(
				args.slice(
					args.indexOf("--max-redirs"),
					args.indexOf("--max-redirs") + 2,
				),
				["--max-redirs", "0"],
			);
		}
		// Only the warm-up runs curl -v; every later call has its secret.
		assert.deepEqual(
			probes.map(({ args, bypass }) => [args.includes("-v"), bypass]),
			probes.map(() => [false, "fake-token"]),
		);
		const output = probes[0].args[probes[0].args.indexOf("-o") + 1];
		assert.ok(output.startsWith(dir) && output !== "/dev/null");
		assert.equal(probes[1].args[probes[1].args.indexOf("-o") + 1], "/dev/null");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
