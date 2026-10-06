// Live cutover verifier for the old blog host (blogthedata merge plan §4.10).
// legacy/blogthedata/url-map.json and url-union.json say what every old URL
// must do once the redirect-only project `blogthedata` serves the old hosts;
// this script asks the real hosts and fails on any difference. Every request
// is sent with redirects off, so each hop is checked on its own. Run
// `npm ci` first: it imports the repo's own modules and their dependencies.
//
// Modes (each prints a per-check summary and exits 1 on any failure, 2 on a
// usage error; any other flag combination is a usage error):
//
//   --production
//     Every url-map row on each of meta.hosts (blogthedata.com,
//     www.blogthedata.com, blogthedata.vercel.app) over https and http, with
//     the destinations on https://www.jsolly.com. Cutover C2 step 7.
//   --production --sample
//     The fixed sample below, on the same hosts: the daily and per-deployment
//     run of the future legacy-redirects.yml workflow (C2 step 8).
//   --base-url <url> [--transport fetch|vercel-curl] [--bypass-env NAME]
//     Every row on that one deployment, over its own scheme only (the http to
//     https upgrade is a custom-domain behaviour, checked by --production). The
//     destinations are still checked on https://www.jsolly.com, always with
//     fetch: the redirects point there, not at the deployment. C2 step 5, on
//     the staged legacy deployment.
//   --destinations-only --base-url <url> [--transport ...] [--bypass-env NAME]
//     Only the destinations, on <url> (a jsolly deployment), and the two feeds'
//     XML Content-Types (FEEDS in src/lib/blog/constants.ts). C0 step 8 (the
//     preview, vercel-curl) and C1 (production).
//   <url> is an https origin (http only for a loopback stub, as in the tests).
//
// Transports (scripts/verify-blogthedata-transports.mjs), which apply to the
// --base-url requests only:
//   fetch (default): Node fetch with `redirect: "manual"`. `--bypass-env NAME`
//     sends the Protection Bypass for Automation secret held in environment
//     variable NAME as `x-vercel-protection-bypass`; the value is never printed.
//   vercel-curl: John only, for SSO-protected deployments. Each request runs
//     the repo's pinned CLI as
//       vercel curl <url> --scope jsollys-projects --cwd <empty temp dir> --
//         -sS -o <file|/dev/null> --max-redirs 0 --max-time 30 -w <format>
//     so the CLI never links or prompts inside a checkout. The write-out is the
//     status, Location, Content-Type and Cache-Control headers (the plan's
//     `%{http_code} %{redirect_url}` cannot check served files), and served
//     files are written to a temp file to compare their bytes. One serial
//     warm-up call (with curl -v) first lets the CLI find or create the
//     deployment's bypass secret and reads it from the request headers; every
//     later call gets it as VERCEL_AUTOMATION_BYPASS_SECRET, which the CLI uses
//     without asking the API, so the run creates at most one secret and a
//     rate-limited API call cannot turn into a 401. The run stops when the
//     warm-up shows no secret, or answers anything but 2xx, 3xx or 404.
//
// A request is retried once, with a warning, only on a transient transport
// error (a fetch network error or timeout; curl exit 6, 7 or 28). Anything
// else, such as a CLI login or scope error or an unreadable write-out, fails
// its check at once. A failed request is a failure, never a skip.
//
// Checks:
//   - 301: every form of a redirect row (exact; for page rows also slashless,
//     /index.html and /index.html/), plus every served index.html form in
//     url-union.json (derived from the file), answers 301 with the exact
//     Location.
//   - http: on http the host first answers 308 to the same https URL, then that
//     URL gives the check's https answer.
//   - query: ?servings=6&starch=a:b on /recipes/meals/, ?searched=django on
//     /search/ and ?utm_source=x on the first post row reach the Location
//     (compared as parsed parameters, since `:` may arrive encoded).
//   - serve-200: 200, the file's Content-Type (the kill-switch workers' exact
//     no-cache headers), with the body byte-equal to the repo file; a
//     security.txt must also expire more than 30 days from now.
//   - stays-404: every stays-404 row (slash and slashless page forms, pattern
//     samples) and the lowercase variants of mixed-case redirect sources
//     answer 404.
//   - destinations: every distinct 301 destination answers 200 on jsolly.com,
//     and the two feeds answer their FEEDS types.
//   Recorded only, never failed: the double-slash forms //post/<slug>/,
//   /post/<slug>// and // of the first post row (§2.3, J28: each hop on the
//   same host is printed), and fragments, which never reach a server.
//
// The sample (--sample), derived from url-map.json by these fixed rules:
//   the first mixed-case post redirect row; the first category redirect row;
//   the redirect row from an old /post/ page to a recipe page (the
//   instant-pot post); the feed row to the RSS feed; every service-worker
//   row; the first stays-404 row that is the lowercase of a redirect source;
//   and the security row served 200. It also checks jsolly.com's own
//   /.well-known/security.txt, so both sites' security.txt files are watched.
//   It has no query probes and no double-slash records.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
	isMixedCase,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	lowercaseNegatives,
	probePaths,
	readLegacyJson,
	SERVICE_WORKER_HEADERS,
} from "./blogthedata-redirects.mjs";
import { DAY_MS, fieldLines, securityTxtExpires } from "./site-files.mjs";
import {
	curlArgs,
	fetchTransport,
	vercelCurlTransport,
} from "./verify-blogthedata-transports.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// The call sites run plain `node`, which has no .js → .ts resolver, and the
// repo's Biome rewrites a static `.ts` specifier to `.js`; so the TypeScript
// module is imported by URL, which Node's type stripping loads as it is.
const { FEEDS } = await import(
	new URL("../src/lib/blog/constants.ts", import.meta.url).href
);
const LEGACY_PUBLIC = join(LEGACY_DIR, "public");
const JSOLLY_SECURITY_TXT = "/.well-known/security.txt";
const VERCEL_BIN = join(ROOT, "node_modules", ".bin", "vercel");
const CONCURRENCY = 8;
const EXPIRY_MARGIN_DAYS = 30;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FEED_TYPES = Object.fromEntries(
	Object.values(FEEDS).map((feed) => [feed.path, feed.type]),
);
const SERVED_TYPES = {
	".html": "text/html",
	".js": "application/javascript",
	".txt": "text/plain",
};
const SW_HEADERS = Object.fromEntries(
	SERVICE_WORKER_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]),
);
// The answer field each checkable header arrives in.
const HEADER_FIELDS = {
	"content-type": "contentType",
	"cache-control": "cacheControl",
};
// Every check belongs to one of these groups; the summary lists them in order.
export const GROUP = Object.freeze({
	redirect: "301 redirect",
	upgrade: "http upgrade",
	query: "query kept",
	served: "served 200",
	stays404: "stays 404",
	lowercase404: "lowercase 404",
	destination: "destination 200",
	securityTxt: "security.txt",
});
const USAGE = `usage: node scripts/verify-blogthedata-cutover.mjs
  --production [--sample]
  --base-url <url> [--transport fetch|vercel-curl] [--bypass-env NAME]
  --destinations-only --base-url <url> [--transport fetch|vercel-curl] [--bypass-env NAME]`;

const mediaType = (contentType) =>
	(contentType ?? "").split(";")[0].trim().toLowerCase();
// Each segment percent-encoded, so samples with spaces form a valid URL.
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const withQuery = (url, query) => (query ? `${url}?${query}` : url);

// Whether `actual` is the Location `expected`: exact, except that a query is
// compared as parsed parameters (Vercel may percent-encode `:`).
function locationProblem(actual, expected) {
	if (actual === expected) {
		return null;
	}
	const got = `Location ${actual ?? "(none)"}, not ${expected}`;
	const [base, query] = expected.split("?");
	if (!query || !actual) {
		return got;
	}
	let url;
	try {
		url = new URL(actual);
	} catch {
		return got;
	}
	const same =
		`${url.origin}${url.pathname}` === base &&
		url.hash === "" &&
		isDeepStrictEqual([...url.searchParams], [...new URLSearchParams(query)]);
	return same ? null : got;
}

function statusProblem(response, status) {
	if (response.status === status) {
		return null;
	}
	const location = response.location ? ` (Location ${response.location})` : "";
	return `status ${response.status}, not ${status}${location}`;
}

// A header value with parameters must match exactly; a bare media type
// matches the Content-Type's media type.
function headerProblem(response, name, expected) {
	const actual = response[HEADER_FIELDS[name]];
	const matches =
		name === "content-type" && !expected.includes(";")
			? mediaType(actual) === expected
			: actual === expected;
	return matches ? null : `${name} ${actual ?? "(none)"}, not ${expected}`;
}

// A security.txt `extra` check: it must expire more than 30 days from now.
function expiryProblem(response, { now }) {
	const text = response.body.toString("utf8");
	const expires = securityTxtExpires(fieldLines(text).fields);
	if (!expires || Number.isNaN(expires.time)) {
		return "Expires is not one valid RFC 3339 time";
	}
	return expires.time - now > EXPIRY_MARGIN_DAYS * DAY_MS
		? null
		: `Expires ${expires.text} is within ${EXPIRY_MARGIN_DAYS} days`;
}

// What a served file must answer: 200, `headers` (name → expected value),
// its exact bytes, and the optional `extra(response, context)` check.
function servedExpectation(file, { headers, extra }) {
	const bytes = readFileSync(file);
	for (const name of Object.keys(headers)) {
		if (!HEADER_FIELDS[name]) {
			throw new Error(`header ${name} is not one the transports report`);
		}
	}
	return {
		body: true,
		check(response, context) {
			const problems = [
				statusProblem(response, 200),
				...Object.entries(headers).map(([name, expected]) =>
					headerProblem(response, name, expected),
				),
			];
			if (response.status === 200) {
				if (!bytes.equals(response.body)) {
					problems.push("body differs from the repo file");
				}
				problems.push(extra?.(response, context));
			}
			return problems.filter(Boolean).join("; ") || null;
		},
	};
}

const statusExpectation = (status) => ({
	body: false,
	check: (response) => statusProblem(response, status),
});

const redirectExpectation = (location) => ({
	body: false,
	check: (response) =>
		statusProblem(response, 301) ??
		locationProblem(response.location, location),
});

const destinationExpectation = (feedType) => ({
	body: false,
	check(response) {
		const problem = statusProblem(response, 200);
		if (problem || !feedType) {
			return problem;
		}
		return mediaType(response.contentType) === feedType
			? null
			: `content-type ${response.contentType}, not ${feedType}`;
	},
});

// The served file's headers: the workers' exact no-cache pair, else the
// file type's media type.
function servedHeaders(row) {
	if (row.class === "service-worker") {
		return SW_HEADERS;
	}
	const type = SERVED_TYPES[extname(row.source)];
	if (!type) {
		throw new Error(`no expected Content-Type for served row ${row.id}`);
	}
	return { "content-type": type };
}

// The group and expectation every probe of `row` gets; with `query`, the
// redirect must carry that query too.
function rowCheck(row, query = "") {
	switch (row.action) {
		case "redirect-301":
			return {
				group: query ? GROUP.query : GROUP.redirect,
				expectation: redirectExpectation(withQuery(row.destination, query)),
			};
		case "serve-200":
			return {
				group: GROUP.served,
				expectation: servedExpectation(join(LEGACY_PUBLIC, row.source), {
					headers: servedHeaders(row),
					extra: row.class === "security" ? expiryProblem : undefined,
				}),
			};
		case "stays-404":
			return { group: GROUP.stays404, expectation: statusExpectation(404) };
		default:
			throw new Error(`url-map row ${row.id} has unknown action ${row.action}`);
	}
}

function firstPostRow(map) {
	const row = map.rows.find(
		(candidate) =>
			candidate.class === "post" && candidate.action === "redirect-301",
	);
	if (!row) {
		throw new Error("url-map has no post redirect row");
	}
	return row;
}

// The index.html forms the old host serves today, from url-union.json.
export function servedIndexForms(union) {
	return union.elements.filter(
		(element) =>
			element.kind === "path" &&
			element.served_today &&
			element.path.endsWith("index.html"),
	);
}

// The fixed --sample rows; see the header for the rules.
export function sampleRows(map) {
	const rows = map.rows;
	const lowered = new Set(
		rows
			.filter((row) => row.action === "redirect-301")
			.map((row) => row.source.toLowerCase()),
	);
	const pick = (name, predicate) => {
		const row = rows.find(predicate);
		if (!row) {
			throw new Error(`url-map has no row for the sample's ${name}`);
		}
		return row;
	};
	return [
		pick(
			"mixed-case post",
			(row) =>
				row.class === "post" &&
				row.action === "redirect-301" &&
				isMixedCase(row),
		),
		pick(
			"category",
			(row) => row.class === "category" && row.action === "redirect-301",
		),
		pick(
			"old post to a recipe page",
			(row) =>
				row.class === "recipe-page" &&
				row.action === "redirect-301" &&
				row.source.startsWith("/post/"),
		),
		pick(
			"RSS feed",
			(row) =>
				row.class === "feed" &&
				row.destination === `${JSOLLY_ORIGIN}${FEEDS.rss.path}`,
		),
		...rows.filter((row) => row.class === "service-worker"),
		pick(
			"lowercase stays-404",
			(row) => row.action === "stays-404" && lowered.has(row.source),
		),
		pick(
			"security.txt",
			(row) => row.class === "security" && row.action === "serve-200",
		),
	];
}

// The { group, path, expectation } probes each legacy host must answer for
// these rows.
function rowProbes(rows) {
	return rows.flatMap((row) => {
		const check = rowCheck(row);
		return probePaths(row).map((path) => ({ ...check, path }));
	});
}

// Every distinct 301 destination of these rows, the feeds with their type.
function destinationProbes(rows) {
	const paths = new Set(
		rows
			.filter((row) => row.action === "redirect-301")
			.map((row) => row.destination.slice(JSOLLY_ORIGIN.length)),
	);
	return [...paths].map((path) => ({
		group: GROUP.destination,
		path,
		expectation: destinationExpectation(FEED_TYPES[path]),
	}));
}

// One probe per path: the first wins.
function uniqueByPath(probes) {
	const seen = new Set();
	return probes.filter(({ path }) => !seen.has(path) && seen.add(path));
}

function fragmentNote() {
	const pages = readLegacyJson("fragment-ids.json").pages;
	const ids = Object.values(pages).reduce((sum, list) => sum + list.length, 0);
	return `fragments: ${Object.keys(pages).length} old pages carry ${ids} ids (legacy/blogthedata/fragment-ids.json); the browser keeps #fragment across the 301 and never sends it, so scripts/built/legacy-fragments.test.mjs checks the ids against the build`;
}

// A plan: `legacy` probes run on each legacy target, `destinations` on the
// destination origin, `doubleSlash` paths are recorded hop by hop on each
// target, and `notes` are printed as they are.

// Every row, every served index.html form, the lowercase negatives, the query
// probes, the destinations and the double-slash records.
export function fullPlan(map, union) {
	const rowsById = new Map(map.rows.map((row) => [row.id, row]));
	const post = firstPostRow(map);
	const indexForms = servedIndexForms(union);
	const queries = [
		// biome-ignore lint/security/noSecrets: the plan's recipe query probe, not credential material.
		["/recipes/meals/", "servings=6&starch=a:b"],
		["/search/", "searched=django"],
		[post.source, "utm_source=x"],
	];
	const legacy = uniqueByPath([
		...rowProbes(map.rows),
		...indexForms.map((element) => ({
			...rowCheck(rowsById.get(element.row_id)),
			path: element.probe,
		})),
		...lowercaseNegatives(map.rows).map((path) => ({
			group: GROUP.lowercase404,
			path,
			expectation: statusExpectation(404),
		})),
		...queries.map(([source, query]) => {
			const row = map.rows.find(
				(candidate) =>
					candidate.action === "redirect-301" && candidate.source === source,
			);
			if (!row) {
				throw new Error(`url-map has no redirect row for ${source}`);
			}
			return { ...rowCheck(row, query), path: `${source}?${query}` };
		}),
	]);
	return {
		legacy,
		destinations: destinationProbes(map.rows),
		doubleSlash: [`/${post.source}`, `${post.source}/`, "//"],
		notes: [
			`url-union.json: ${indexForms.length} served index.html forms probed`,
			fragmentNote(),
		],
	};
}

// The fixed sample (see the header) and jsolly.com's security.txt.
export function samplePlan(map) {
	const rows = sampleRows(map);
	return {
		legacy: uniqueByPath(rowProbes(rows)),
		destinations: [
			...destinationProbes(rows),
			{
				group: GROUP.securityTxt,
				path: JSOLLY_SECURITY_TXT,
				expectation: servedExpectation(
					join(ROOT, "public", JSOLLY_SECURITY_TXT),
					{ headers: { "content-type": "text/plain" }, extra: expiryProblem },
				),
			},
		],
		doubleSlash: [],
		notes: [],
	};
}

// Only the destinations and the feeds' types.
export function destinationsPlan(map) {
	return {
		legacy: [],
		destinations: destinationProbes(map.rows),
		doubleSlash: [],
		notes: [],
	};
}

async function pool(tasks, size) {
	const results = new Array(tasks.length);
	let next = 0;
	async function worker() {
		while (next < tasks.length) {
			const index = next++;
			// biome-ignore lint/performance/noAwaitInLoops: each worker takes the next task once its last one settles.
			results[index] = await tasks[index]();
		}
	}
	await Promise.all(Array.from({ length: size }, worker));
	return results;
}

// One request. A transient transport error is retried once, with a warning;
// any other error, or a second one, is the check's failure.
async function ask(context, request, url, body) {
	try {
		return await request(url, { body });
	} catch (error) {
		if (!error.transient) {
			return { error: `request failed: ${error.message}` };
		}
		context.warn(`⚠ retrying ${url} after: ${error.message}`);
	}
	try {
		return await request(url, { body });
	} catch (error) {
		return { error: `request failed: ${error.message}` };
	}
}

function runCheck(context, request, { group, url, expectation }) {
	return async () => {
		const response = await ask(context, request, url, expectation.body);
		return {
			group,
			url,
			problem: response.error ?? expectation.check(response, context),
		};
	};
}

// http → 308 to the https URL → the https answer.
function runUpgrade(context, request, httpUrl, httpsUrl, expectation) {
	return async () => {
		const upgrade = await ask(context, request, httpUrl, false);
		const problem =
			upgrade.error ??
			statusProblem(upgrade, 308) ??
			locationProblem(upgrade.location, httpsUrl);
		if (problem) {
			return { group: GROUP.upgrade, url: httpUrl, problem };
		}
		const response = await ask(
			context,
			request,
			upgrade.location,
			expectation.body,
		);
		const then = response.error ?? expectation.check(response, context);
		return {
			group: GROUP.upgrade,
			url: httpUrl,
			problem: then && `after the 308, ${then}`,
		};
	};
}

// Each same-host hop of a double-slash form, for the record.
function recordHops(context, request, origin, path) {
	return async () => {
		const url = `${origin}${path}`;
		const hops = [];
		let current = url;
		for (let hop = 0; hop < 3; hop += 1) {
			// biome-ignore lint/performance/noAwaitInLoops: each hop follows the previous one's Location.
			const response = await ask(context, request, current, false);
			if (response.error) {
				hops.push(response.error);
				break;
			}
			hops.push(`${response.status} ${response.location ?? ""}`.trim());
			if (!response.location) {
				break;
			}
			current = new URL(response.location, current).href;
			if (!current.startsWith(`${origin}/`)) {
				break;
			}
		}
		return `double slash ${url}: ${hops.join(" → ")}`;
	};
}

// Runs `plan`. `targets` are the legacy origins ({ origin, upgradeOrigin },
// upgradeOrigin null to skip http), `request` asks them, and
// `destinationRequest` asks `destinationOrigin`. `now` dates the
// security.txt expiry and `warn` reports retries. Returns every check's
// { group, url, problem } (problem null when it passed) and the records.
export async function verifyCutover({
	plan,
	targets,
	request,
	destinationOrigin,
	destinationRequest,
	now = Date.now(),
	warn = console.warn,
}) {
	const context = { now, warn };
	const tasks = [];
	const recordTasks = [];
	for (const { origin, upgradeOrigin } of targets) {
		for (const { group, path, expectation } of plan.legacy) {
			const [pathname, query] = path.split("?");
			const url = withQuery(`${origin}${encodePath(pathname)}`, query);
			tasks.push(runCheck(context, request, { group, url, expectation }));
			if (upgradeOrigin) {
				const httpUrl = withQuery(
					`${upgradeOrigin}${encodePath(pathname)}`,
					query,
				);
				tasks.push(runUpgrade(context, request, httpUrl, url, expectation));
			}
		}
		for (const path of plan.doubleSlash) {
			recordTasks.push(recordHops(context, request, origin, path));
		}
	}
	for (const { group, path, expectation } of plan.destinations) {
		tasks.push(
			runCheck(context, destinationRequest, {
				group,
				url: `${destinationOrigin}${path}`,
				expectation,
			}),
		);
	}
	const results = await pool(tasks, CONCURRENCY);
	const records = await pool(recordTasks, CONCURRENCY);
	return { results, records: [...records, ...plan.notes] };
}

function baseOrigin(text) {
	let url;
	try {
		url = new URL(text);
	} catch (error) {
		throw new Error(`--base-url ${text} must start with https://`, {
			cause: error,
		});
	}
	const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !loopback) {
		throw new Error(`--base-url ${text} must start with https://`);
	}
	if (
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	) {
		throw new Error(`--base-url ${text} must be an origin, with no path`);
	}
	return url.origin;
}

// The one mode the flags name, with that mode's options; any other
// combination throws a usage error. `env` holds the --bypass-env variable.
export function parseCli(argv, env) {
	const { values } = parseArgs({
		args: argv,
		options: {
			production: { type: "boolean", default: false },
			sample: { type: "boolean", default: false },
			"destinations-only": { type: "boolean", default: false },
			"base-url": { type: "string" },
			transport: { type: "string" },
			"bypass-env": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const baseUrl = values["base-url"];
	if (values.production === (baseUrl !== undefined)) {
		throw new Error("pass exactly one of --production and --base-url");
	}
	if (values.production) {
		if (values["destinations-only"]) {
			throw new Error("--destinations-only needs --base-url, not --production");
		}
		if (values.transport !== undefined) {
			throw new Error("--transport applies to --base-url only");
		}
		if (values["bypass-env"] !== undefined) {
			throw new Error("--bypass-env applies to --base-url only");
		}
		return { mode: values.sample ? "production-sample" : "production" };
	}
	if (values.sample) {
		throw new Error("--sample runs with --production only");
	}
	const transport = values.transport ?? "fetch";
	if (!["fetch", "vercel-curl"].includes(transport)) {
		throw new Error(`unknown --transport ${transport}`);
	}
	const bypassEnv = values["bypass-env"];
	if (bypassEnv !== undefined && transport !== "fetch") {
		throw new Error("--bypass-env applies to the fetch transport only");
	}
	if (bypassEnv !== undefined && !env[bypassEnv]) {
		throw new Error(`environment variable ${bypassEnv} is empty`);
	}
	return {
		mode: values["destinations-only"] ? "destinations-only" : "base-url",
		origin: baseOrigin(baseUrl),
		transport,
		bypassEnv,
	};
}

const hostTargets = (map) =>
	map.meta.hosts.map((host) => ({
		origin: `https://${host}`,
		upgradeOrigin: `http://${host}`,
	}));

// Each mode's run: its plan, legacy targets, destination origin, and which
// transport ("public" fetch, or the --base-url "base" one) asks each side.
const MODES = {
	production: (_options, { map, union }) => ({
		summary: `url-map.json on ${map.meta.hosts.join(", ")} (https and http); destinations on ${JSOLLY_ORIGIN}`,
		plan: fullPlan(map, union),
		targets: hostTargets(map),
		destinationOrigin: JSOLLY_ORIGIN,
		legacyTransport: "public",
		destinationTransport: "public",
	}),
	"production-sample": (_options, { map }) => ({
		summary: `the url-map.json sample on ${map.meta.hosts.join(", ")} (https and http); destinations on ${JSOLLY_ORIGIN}`,
		plan: samplePlan(map),
		targets: hostTargets(map),
		destinationOrigin: JSOLLY_ORIGIN,
		legacyTransport: "public",
		destinationTransport: "public",
	}),
	"base-url": (options, { map, union }) => ({
		summary: `url-map.json on ${options.origin}; destinations on ${JSOLLY_ORIGIN}`,
		plan: fullPlan(map, union),
		targets: [{ origin: options.origin, upgradeOrigin: null }],
		destinationOrigin: JSOLLY_ORIGIN,
		legacyTransport: "base",
		destinationTransport: "public",
	}),
	"destinations-only": (options, { map }) => ({
		summary: `the url-map destinations on ${options.origin}`,
		plan: destinationsPlan(map),
		targets: [],
		destinationOrigin: options.origin,
		legacyTransport: "base",
		destinationTransport: "base",
	}),
};

// What a parseCli() result runs; pure, so each mode's wiring is testable.
export function modeRun(options, data) {
	return MODES[options.mode](options, data);
}

function report({ results, records }, out) {
	const failures = results.filter((result) => result.problem);
	for (const { group, url, problem } of failures) {
		out(`✗ ${group} ${url}: ${problem}`);
	}
	for (const group of Object.values(GROUP)) {
		const inGroup = results.filter((result) => result.group === group);
		if (inGroup.length === 0) {
			continue;
		}
		const failed = inGroup.filter((result) => result.problem).length;
		out(
			`${failed ? "✗" : "✓"} ${group}: ${inGroup.length - failed} of ${inGroup.length} passed`,
		);
	}
	for (const record of records) {
		out(`recorded: ${record}`);
	}
	out(
		failures.length
			? `✗ ${failures.length} of ${results.length} checks failed.`
			: `✓ all ${results.length} checks passed.`,
	);
	return failures.length ? 1 : 0;
}

// The transport for --base-url requests.
function baseTransport(options, scratch) {
	if (options.transport === "fetch") {
		return fetchTransport(
			options.bypassEnv
				? { "x-vercel-protection-bypass": process.env[options.bypassEnv] }
				: {},
		);
	}
	const shown = curlArgs("<url>", "<empty temp dir>", "<file|/dev/null>");
	console.log(
		`Each probe runs: ${VERCEL_BIN} ${shown.map((arg) => JSON.stringify(arg)).join(" ")}`,
	);
	return vercelCurlTransport(VERCEL_BIN, options.origin, scratch);
}

async function main(argv) {
	let options;
	try {
		options = parseCli(argv, process.env);
	} catch (error) {
		console.error(`✗ ${error.message}\n${USAGE}`);
		return 2;
	}
	const scratch = mkdtempSync(join(tmpdir(), "verify-blogthedata-cutover-"));
	try {
		const run = modeRun(options, {
			map: readLegacyJson("url-map.json"),
			union: readLegacyJson("url-union.json"),
		});
		const transports = { public: fetchTransport() };
		if (options.origin) {
			transports.base = await baseTransport(options, scratch);
		}
		console.log(`Checking ${run.summary}.`);
		const result = await verifyCutover({
			plan: run.plan,
			targets: run.targets,
			request: transports[run.legacyTransport],
			destinationOrigin: run.destinationOrigin,
			destinationRequest: transports[run.destinationTransport],
		});
		return report(result, console.log);
	} catch (error) {
		console.error(`✗ ${error.message}`);
		return 1;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

// Compare real paths: import.meta.url is the realpath, argv[1] may be a symlink.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exitCode = await main(process.argv.slice(2));
}
