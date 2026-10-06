import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { FEEDS } from "../../src/lib/blog/constants.js";
import {
	compileRoutes,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	readLegacyJson,
	routePath,
	SERVICE_WORKER_HEADERS,
} from "../blogthedata-redirects.mjs";
import { DAY_MS, fieldLines, securityTxtExpires } from "../site-files.mjs";
import {
	destinationsPlan,
	fullPlan,
	GROUP,
	modeRun,
	parseCli,
	samplePlan,
	sampleRows,
	servedIndexForms,
	verifyCutover,
} from "../verify-blogthedata-cutover.mjs";
import { fetchTransport } from "../verify-blogthedata-transports.mjs";

// The verifier runs against local stub servers only: one answers as the
// legacy project would (Vercel's own compiled routes over the real
// vercel.json, plus public/), one as Vercel's http → https upgrade in front
// of it, and one as jsolly.com. Nothing here reaches the network.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-blogthedata-cutover.mjs");
const PUBLIC_DIR = join(LEGACY_DIR, "public");
const LEGACY_SECURITY_TXT = join(PUBLIC_DIR, ".well-known", "security.txt");
const JSOLLY_SECURITY_TXT = join(ROOT, "public", ".well-known", "security.txt");
const BYPASS_ENV = "VERIFY_CUTOVER_TEST_BYPASS";
const BYPASS_SECRET = "stub-bypass-secret";
const EMPTY_ENV = "VERIFY_CUTOVER_TEST_EMPTY";
// Facts of the committed url-union.json: 139 page forms plus /index.html.
const SERVED_INDEX_FORMS = 140;
const GEODEV_INDEX = "/category/Geodev/index.html";
const DESTINATIONS_PASSED =
	/✓ destination 200: (?<passed>\d+) of \k<passed> passed/u;
const REQUEST_FAILED = /^request failed: /u;
const NOT_LOGGED_IN = /^request failed: vercel curl exited 1: not logged in$/u;
const AFTER_308_REQUEST_FAILED = /^after the 308, request failed: /u;
const STATUS_308 = /^status 308, not 301/u;
const STATUS_301 = /^status 301, not 308/u;
const WRONG_UPGRADE =
	/^Location http:\/\/127\.0\.0\.1:\d+\/wrong\/, not http:\/\/127\.0\.0\.1:\d+\/atom\/$/u;
const BODY_DIFFERS = /body differs from the repo file/u;
const EXPIRES_SOON = /is within 30 days/u;
const LONG_CACHE = /^cache-control max-age=3600, not no-cache$/u;
const AFTER_308_LONG_CACHE =
	/^after the 308, cache-control max-age=3600, not no-cache$/u;
const NO_CACHE_HEADER = /^cache-control \(none\), not no-cache$/u;
const OCTET_STREAM =
	/^content-type application\/octet-stream, not text\/plain$/u;
const WRONG_FEED_TYPE = /content-type text\/xml, not application\/rss\+xml/u;
const EXPIRES_LINE = /^Expires: .*$/mu;
const STATIC_TYPES = {
	".html": "text/html; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};
const FEED_TYPES = Object.fromEntries(
	Object.values(FEEDS).map((feed) => [
		feed.path,
		`${feed.type}; charset=utf-8`,
	]),
);
const SW_HEADERS = Object.fromEntries(
	SERVICE_WORKER_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]),
);
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
		if (upgradeStub.faults[path]) {
			return upgradeStub.faults[path](res);
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
	// The upgrade faults may name the legacy stub's origin, so a test adds them
	// once both are listening.
	upgradeStub.faults = upgrade;
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

// A served file with its real bytes and status but the given headers.
const servedAs = (source, headers) =>
	answer(200, headers, readFileSync(join(PUBLIC_DIR, source)));

// A plan as comparable text: each probe's group and path.
const planShape = (plan) => ({
	legacy: plan.legacy.map(({ group, path }) => `${group} ${path}`),
	destinations: plan.destinations.map(({ group, path }) => `${group} ${path}`),
	doubleSlash: plan.doubleSlash,
	notes: plan.notes,
});

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
		const plan = fullPlan(map, union);
		const full = await verify(servers, {
			plan,
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
		assert.ok(full.records.some((record) => record.startsWith("fragments: ")));

		// The served index.html forms of the committed union, probed as 301s.
		const indexForms = servedIndexForms(union).map((element) => element.probe);
		assert.equal(indexForms.length, SERVED_INDEX_FORMS);
		assert.ok(indexForms.includes(GEODEV_INDEX));
		assert.ok(
			plan.legacy.some(
				({ group, path }) => group === GROUP.redirect && path === GEODEV_INDEX,
			),
		);
		assert.ok(
			full.records.includes(
				`url-union.json: ${SERVED_INDEX_FORMS} served index.html forms probed`,
			),
		);
		// A union index form that no row form covers gets its own probe, as its
		// row answers (PST-109 stays 404, and its forms are slash and slashless).
		const retired = `${row("PST-109").source}index.html`;
		const fixtureUnion = {
			elements: [
				{
					kind: "path",
					path: retired,
					probe: retired,
					row_id: "PST-109",
					served_today: true,
				},
			],
		};
		const shape = (built) => planShape(built).legacy;
		assert.ok(
			shape(fullPlan(map, fixtureUnion)).includes(
				`${GROUP.stays404} ${retired}`,
			),
		);
		assert.ok(
			!shape(fullPlan(map, { elements: [] })).includes(
				`${GROUP.stays404} ${retired}`,
			),
		);

		// --base-url probes the deployment's own scheme only.
		const direct = await verifyCutover({
			plan,
			targets: [{ origin: servers.legacyStub.origin, upgradeOrigin: null }],
			request: fetchTransport(),
			destinationOrigin: servers.jsollyStub.origin,
			destinationRequest: fetchTransport({
				"x-vercel-protection-bypass": BYPASS_SECRET,
			}),
			now,
		});
		assert.deepEqual(
			direct.results.filter((result) => result.problem),
			[],
		);
		assert.ok(direct.results.every((result) => result.group !== GROUP.upgrade));
		assert.equal(
			direct.results.length,
			plan.legacy.length + plan.destinations.length,
		);

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
	const worker = row("SWK-001").source;
	const workerBytes = readFileSync(join(PUBLIC_DIR, row("SWK-002").source));
	let resets = 0;
	const jsolly = {
		[FEEDS.atom.path]: answer(404),
		[FEEDS.rss.path]: answer(200, { "content-type": "text/xml" }),
	};
	const legacy = {
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
			SW_HEADERS,
			Buffer.concat([workerBytes, Buffer.from("\n")]),
		),
		// The right bytes and status under the wrong headers.
		[worker]: servedAs(worker, {
			...SW_HEADERS,
			"cache-control": "max-age=3600",
		}),
		"/robots.txt": servedAs("/robots.txt", {
			"content-type": "application/octet-stream",
		}),
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
	};
	const servers = await stubs({ legacy, jsolly, upgrade: {} });
	const { legacyStub, upgradeStub, jsollyStub } = servers;
	// http that skips the 308 upgrade, and one that upgrades to the wrong URL.
	Object.assign(upgradeStub.faults, {
		[row("FED-002").source]: answer(301, {
			location: row("FED-002").destination,
		}),
		[row("FED-001").source]: answer(308, {
			location: `${legacyStub.origin}/wrong/`,
		}),
	});
	try {
		const closed = await closedOrigin();
		const labels = {
			[legacyStub.origin]: "https:",
			[upgradeStub.origin]: "http:",
			[jsollyStub.origin]: "jsolly:",
			[closed]: "closed:",
			"https://stub.invalid": "invalid:",
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
				`destination 200 jsolly:${FEEDS.atom.path}`,
				`destination 200 jsolly:${FEEDS.rss.path}`,
				"http upgrade http:/404.html",
				`http upgrade http:${row("FED-001").source}`,
				`http upgrade http:${row("FED-002").source}`,
				`http upgrade http:${row("PST-001").source}`,
				`http upgrade http:${row("PST-001").source}?utm_source=x`,
				`http upgrade http:${row("PST-109").source}`,
				`http upgrade http:${row("SEC-002").source}`,
				`http upgrade http:${row("SRH-001").source}?searched=django`,
				`http upgrade http:${row("SWK-002").source}`,
				`http upgrade http:${worker}`,
				"http upgrade http:/robots.txt",
				`http upgrade http:${meals.source}?servings=6&starch=a:b`,
				`http upgrade http:${slashless}`,
				`query kept https:${row("PST-001").source}?utm_source=x`,
				`query kept https:${row("SRH-001").source}?searched=django`,
				`query kept https:${meals.source}?servings=6&starch=a:b`,
				"served 200 https:/404.html",
				`served 200 https:${row("SEC-002").source}`,
				`served 200 https:${row("SWK-002").source}`,
				`served 200 https:${worker}`,
				"served 200 https:/robots.txt",
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
		assert.match(at(legacyStub.origin, worker), LONG_CACHE);
		assert.match(at(upgradeStub.origin, worker), AFTER_308_LONG_CACHE);
		assert.match(at(legacyStub.origin, "/robots.txt"), OCTET_STREAM);
		assert.match(at(upgradeStub.origin, row("FED-001").source), WRONG_UPGRADE);
		assert.match(at(legacyStub.origin, slashless), STATUS_308);
		assert.match(at(legacyStub.origin, row("SWK-002").source), BODY_DIFFERS);
		assert.match(at(legacyStub.origin, row("SEC-002").source), EXPIRES_SOON);
		assert.match(at(upgradeStub.origin, row("FED-002").source), STATUS_301);
		assert.match(at(jsollyStub.origin, FEEDS.rss.path), WRONG_FEED_TYPE);
		assert.ok(
			result.records.includes(`double slash ${legacyStub.origin}//: 500`),
			result.records.join("\n"),
		);

		// One probe: at a closed port it fails after one retry; with a
		// non-transient error it fails on its only call, with no warning.
		const destinationsPlanned = destinationsPlan(map);
		const onePlan = {
			...destinationsPlanned,
			destinations: destinationsPlanned.destinations.slice(0, 1),
		};
		const onePath = onePlan.destinations[0].path;
		const refused = await verifyCutover({
			plan: onePlan,
			targets: [],
			request: fetchTransport(),
			destinationOrigin: closed,
			destinationRequest: fetchTransport(),
			warn,
		});
		assert.deepEqual(failures(refused, labels), [
			`destination 200 closed:${onePath}`,
		]);
		assert.match(problemOf(refused, `${closed}${onePath}`), REQUEST_FAILED);
		assert.equal(
			warnings.filter((message) => message.includes(closed)).length,
			1,
		);
		let calls = 0;
		const loggedOut = () => {
			calls += 1;
			return Promise.reject(new Error("vercel curl exited 1: not logged in"));
		};
		const warned = warnings.length;
		const denied = await verifyCutover({
			plan: onePlan,
			targets: [],
			request: loggedOut,
			destinationOrigin: "https://stub.invalid",
			destinationRequest: loggedOut,
			warn,
		});
		assert.equal(calls, 1);
		assert.equal(warnings.length, warned);
		assert.match(
			problemOf(denied, `https://stub.invalid${onePath}`),
			NOT_LOGGED_IN,
		);

		// The daily sample reports the faulty sampled rows, and jsolly.com's
		// security.txt when its bytes change or it nears expiry.
		legacy[worker] = servedAs(worker, {
			"content-type": SW_HEADERS["content-type"],
		});
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
				`destination 200 jsolly:${FEEDS.rss.path}`,
				`http upgrade http:${row("FED-002").source}`,
				`http upgrade http:${row("SWK-002").source}`,
				`http upgrade http:${worker}`,
				`served 200 https:${row("SWK-002").source}`,
				`served 200 https:${worker}`,
				"security.txt jsolly:/.well-known/security.txt",
			].sort(),
		);
		assert.match(
			problemOf(sample, `${legacyStub.origin}${worker}`),
			NO_CACHE_HEADER,
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
				`✗ destination 200 ${jsollyStub.origin}${FEEDS.atom.path}: status 404, not 200`,
			),
			cli.stdout,
		);
	} finally {
		await close(Object.values(servers));
	}
});

it("Each valid flag set runs its own mode, plan, targets and transports", () => {
	const data = { map, union };
	const env = { [BYPASS_ENV]: BYPASS_SECRET };
	const staged = "https://blogthedata-abc123.vercel.app";
	const hosts = map.meta.hosts.map((host) => ({
		origin: `https://${host}`,
		upgradeOrigin: `http://${host}`,
	}));
	const cases = [
		{
			args: ["--production"],
			options: { mode: "production" },
			plan: fullPlan(map, union),
			targets: hosts,
			destinationOrigin: JSOLLY_ORIGIN,
			transports: ["public", "public"],
		},
		{
			args: ["--production", "--sample"],
			options: { mode: "production-sample" },
			plan: samplePlan(map),
			targets: hosts,
			destinationOrigin: JSOLLY_ORIGIN,
			transports: ["public", "public"],
		},
		{
			args: ["--base-url", staged, "--transport", "vercel-curl"],
			options: {
				mode: "base-url",
				origin: staged,
				transport: "vercel-curl",
				bypassEnv: undefined,
			},
			plan: fullPlan(map, union),
			targets: [{ origin: staged, upgradeOrigin: null }],
			destinationOrigin: JSOLLY_ORIGIN,
			transports: ["base", "public"],
		},
		{
			args: ["--base-url", `${staged}/`, "--bypass-env", BYPASS_ENV],
			options: {
				mode: "base-url",
				origin: staged,
				transport: "fetch",
				bypassEnv: BYPASS_ENV,
			},
			plan: fullPlan(map, union),
			targets: [{ origin: staged, upgradeOrigin: null }],
			destinationOrigin: JSOLLY_ORIGIN,
			transports: ["base", "public"],
		},
		{
			args: ["--destinations-only", "--base-url", JSOLLY_ORIGIN],
			options: {
				mode: "destinations-only",
				origin: JSOLLY_ORIGIN,
				transport: "fetch",
				bypassEnv: undefined,
			},
			plan: destinationsPlan(map),
			targets: [],
			destinationOrigin: JSOLLY_ORIGIN,
			transports: ["base", "base"],
		},
	];
	for (const expected of cases) {
		const options = parseCli(expected.args, env);
		assert.deepEqual(options, expected.options, expected.args.join(" "));
		const run = modeRun(options, data);
		assert.deepEqual(planShape(run.plan), planShape(expected.plan));
		assert.deepEqual(run.targets, expected.targets);
		assert.equal(run.destinationOrigin, expected.destinationOrigin);
		assert.deepEqual(
			[run.legacyTransport, run.destinationTransport],
			expected.transports,
		);
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
