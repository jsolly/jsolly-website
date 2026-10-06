// Live cutover verifier for the old blog host (blogthedata merge plan §4.10).
// legacy/blogthedata/url-map.json and url-union.json say what every old URL
// must do once the redirect-only project `blogthedata` serves the old hosts;
// this script asks the real hosts and fails on any difference. Every request
// is sent with redirects off, so each hop is checked on its own.
//
// Modes (each prints a per-check summary and exits 1 on any failure, 2 on a
// usage error):
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
//     XML Content-Types. C0 step 8 (the preview, vercel-curl) and C1 (production).
//
// Transports, which apply to the --base-url requests only:
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
//     files are written to a temp file to compare their bytes.
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
//   - serve-200: 200, the file's Content-Type (and the kill-switch workers'
//     no-cache headers), with the body byte-equal to the repo file; a
//     security.txt must also expire more than 30 days from now.
//   - stays-404: every stays-404 row (slash and slashless page forms, pattern
//     samples) and the lowercase variants of mixed-case redirect sources
//     answer 404.
//   - destinations: every distinct 301 destination answers 200 on jsolly.com,
//     and the two feeds answer application/rss+xml and application/atom+xml.
//   Recorded only, never failed: the double-slash forms //post/<slug>/,
//   /post/<slug>// and // (§2.3, J28: each hop on the same host is printed),
//   and fragments, which never reach a server.
//
// The sample (--sample), derived from url-map.json by these fixed rules:
//   the first post redirect row whose source has an uppercase letter; the
//   first category redirect row; the redirect row from an old /post/ page to
//   a recipe page (the instant-pot post); the feed row to /blog/rss.xml; every
//   service-worker row; the first stays-404 row that is the lowercase of a
//   redirect source; and the security row served 200. It also checks
//   jsolly.com's own /.well-known/security.txt, so both sites' security.txt
//   files are watched.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
	isPageRow,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	readLegacyJson,
	redirectForms,
	SERVICE_WORKER_HEADERS,
} from "./blogthedata-redirects.mjs";
import { fieldLines, fieldValues } from "./site-files.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEGACY_PUBLIC = join(LEGACY_DIR, "public");
const JSOLLY_SECURITY_TXT = "/.well-known/security.txt";
const VERCEL_BIN = join(ROOT, "node_modules", ".bin", "vercel");
const VERCEL_SCOPE = "jsollys-projects";
const TIMEOUT_SECONDS = 30;
const CONCURRENCY = 8;
const DAY_MS = 86_400_000;
const EXPIRY_MARGIN_DAYS = 30;
const UPPERCASE = /[A-Z]/u;
// curl's write-out, after a marker so CLI chatter on stdout cannot be misread.
const CURL_MARKER = "verify-blogthedata-cutover";
const CURL_WRITE_OUT = `\n${CURL_MARKER}\n%{http_code}\n%header{location}\n%header{content-type}\n%header{cache-control}`;
const QUERY_PROBES = [
	// biome-ignore lint/security/noSecrets: the plan's recipe query probe, not credential material.
	{ source: "/recipes/meals/", query: "servings=6&starch=a:b" },
	{ source: "/search/", query: "searched=django" },
	{ source: null, query: "utm_source=x" },
];
const FEED_TYPES = {
	"rss.xml": "application/rss+xml",
	"atom.xml": "application/atom+xml",
};
const SERVED_TYPES = {
	".html": "text/html",
	".js": "application/javascript",
	".txt": "text/plain",
};
const SW_HEADERS = Object.fromEntries(
	SERVICE_WORKER_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]),
);
const GROUPS = [
	"301 redirect",
	"http upgrade",
	"query kept",
	"served 200",
	"stays 404",
	"lowercase 404",
	"destination 200",
	"security.txt",
];
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

function expiryProblem(body, now) {
	const expires = fieldValues(
		fieldLines(body.toString("utf8")).fields,
		"expires",
	);
	const at = expires.length === 1 ? Date.parse(expires[0]) : Number.NaN;
	if (Number.isNaN(at)) {
		return `Expires is ${JSON.stringify(expires)}, not one time`;
	}
	return at - now > EXPIRY_MARGIN_DAYS * DAY_MS
		? null
		: `Expires ${expires[0]} is within ${EXPIRY_MARGIN_DAYS} days`;
}

// What a served file must answer: 200, its type, its exact bytes.
function servedExpectation(file, { serviceWorker, securityTxt, now }) {
	const bytes = readFileSync(file);
	const type = SERVED_TYPES[extname(file)];
	if (!type) {
		throw new Error(`no expected Content-Type for served file ${file}`);
	}
	return {
		body: true,
		check(response) {
			const problems = [statusProblem(response, 200)];
			if (serviceWorker) {
				if (response.contentType !== SW_HEADERS["content-type"]) {
					problems.push(`Content-Type ${response.contentType}`);
				}
				if (response.cacheControl !== SW_HEADERS["cache-control"]) {
					problems.push(`Cache-Control ${response.cacheControl}`);
				}
			} else if (mediaType(response.contentType) !== type) {
				problems.push(`Content-Type ${response.contentType}, not ${type}`);
			}
			if (response.status === 200 && !bytes.equals(response.body)) {
				problems.push("body differs from the repo file");
			}
			if (securityTxt && response.status === 200) {
				problems.push(expiryProblem(response.body, now));
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

// The fixed --sample rows; see the header for the rules.
export function sampleRows(map) {
	const rows = map.rows;
	const redirects = rows.filter((row) => row.action === "redirect-301");
	const lowered = new Set(redirects.map((row) => row.source.toLowerCase()));
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
				UPPERCASE.test(row.source),
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
			(row) => row.class === "feed" && row.destination.endsWith("/rss.xml"),
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

// The index.html forms the old host serves today, from url-union.json.
const servedIndexForms = (union) =>
	union.elements.filter(
		(element) =>
			element.kind === "path" &&
			element.served_today &&
			element.path.endsWith("index.html"),
	);

// Every [group, path, expectation] the legacy host must answer for these rows.
function legacyProbes(rows, { map, union, now }) {
	const probes = [];
	const rowsById = new Map(map.rows.map((row) => [row.id, row]));
	const sources = new Set(map.rows.map((row) => row.source));
	for (const row of rows) {
		if (row.action === "redirect-301") {
			for (const path of redirectForms(row)) {
				probes.push([
					"301 redirect",
					path,
					redirectExpectation(row.destination),
				]);
			}
		} else if (row.action === "serve-200") {
			const expectation = servedExpectation(join(LEGACY_PUBLIC, row.source), {
				serviceWorker: row.class === "service-worker",
				securityTxt: row.class === "security",
				now,
			});
			probes.push(["served 200", row.source, expectation]);
		} else {
			if (row.match === "pattern" && !(row.samples?.length > 0)) {
				throw new Error(`stays-404 pattern row ${row.id} has no samples`);
			}
			const paths =
				row.match === "pattern"
					? row.samples
					: isPageRow(row)
						? [row.source, row.source.slice(0, -1)]
						: [row.source];
			for (const path of paths) {
				probes.push(["stays 404", path, statusExpectation(404)]);
			}
		}
	}
	const included = new Set(rows.map((row) => row.id));
	for (const element of servedIndexForms(union)) {
		if (!included.has(element.row_id)) {
			continue;
		}
		const row = rowsById.get(element.row_id);
		probes.push(
			row.action === "redirect-301"
				? ["301 redirect", element.probe, redirectExpectation(row.destination)]
				: ["stays 404", element.probe, statusExpectation(404)],
		);
	}
	for (const row of rows) {
		const lower = row.source.toLowerCase();
		if (
			row.action === "redirect-301" &&
			UPPERCASE.test(row.source) &&
			!sources.has(lower)
		) {
			probes.push(["lowercase 404", lower, statusExpectation(404)]);
		}
	}
	return probes;
}

function queryProbes(map) {
	const firstPost = map.rows.find(
		(row) => row.class === "post" && row.action === "redirect-301",
	);
	return QUERY_PROBES.map(({ source, query }) => {
		const row = map.rows.find(
			(candidate) =>
				candidate.action === "redirect-301" &&
				candidate.source === (source ?? firstPost.source),
		);
		if (!row) {
			throw new Error(`url-map has no redirect row for ${source}`);
		}
		return [
			"query kept",
			`${row.source}?${query}`,
			redirectExpectation(withQuery(row.destination, query)),
		];
	});
}

function doubleSlashPaths(map) {
	const post = map.rows.find(
		(row) => row.class === "post" && row.action === "redirect-301",
	);
	return [`/${post.source}`, `${post.source}/`, "//"];
}

// Paths and their expected jsolly answers: every distinct 301 destination
// path, the feeds with their XML type.
function destinationProbes(rows) {
	const paths = [
		...new Set(
			rows
				.filter((row) => row.action === "redirect-301")
				.map((row) => row.destination.slice(JSOLLY_ORIGIN.length)),
		),
	];
	return paths.map((path) => {
		const feedType = FEED_TYPES[path.split("/").pop()];
		return [
			"destination 200",
			path,
			{
				body: false,
				check(response) {
					const problem = statusProblem(response, 200);
					if (problem || !feedType) {
						return problem;
					}
					return mediaType(response.contentType) === feedType
						? null
						: `Content-Type ${response.contentType}, not ${feedType}`;
				},
			},
		];
	});
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

// One request, retried once on a transport error; a second error is the
// check's failure, never a skip.
async function ask(request, url, body) {
	try {
		return await request(url, { body });
	} catch {
		try {
			return await request(url, { body });
		} catch (error) {
			return { error: `request failed: ${error.message}` };
		}
	}
}

function runCheck(request, group, url, expectation) {
	return async () => {
		const response = await ask(request, url, expectation.body);
		return {
			group,
			url,
			problem: response.error ?? expectation.check(response),
		};
	};
}

// http → 308 to the https URL → the https answer.
function runUpgrade(request, httpUrl, httpsUrl, expectation) {
	return async () => {
		const upgrade = await ask(request, httpUrl, false);
		const problem =
			upgrade.error ??
			statusProblem(upgrade, 308) ??
			locationProblem(upgrade.location, httpsUrl);
		if (problem) {
			return { group: "http upgrade", url: httpUrl, problem };
		}
		const response = await ask(request, upgrade.location, expectation.body);
		const then = response.error ?? expectation.check(response);
		return {
			group: "http upgrade",
			url: httpUrl,
			problem: then && `after the 308, ${then}`,
		};
	};
}

// Each same-host hop of a double-slash form, for the record.
function recordHops(request, url) {
	return async () => {
		const hops = [];
		let current = url;
		const origin = url.slice(0, url.indexOf("/", url.indexOf("//") + 2));
		for (let hop = 0; hop < 3; hop += 1) {
			// biome-ignore lint/performance/noAwaitInLoops: each hop follows the previous one's Location.
			const response = await ask(request, current, false);
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

function fragmentRecord() {
	const pages = readLegacyJson("fragment-ids.json").pages;
	const ids = Object.values(pages).reduce((sum, list) => sum + list.length, 0);
	return `fragments: ${Object.keys(pages).length} old pages carry ${ids} ids (legacy/blogthedata/fragment-ids.json); the browser keeps #fragment across the 301 and never sends it, so scripts/built/legacy-fragments.test.mjs checks the ids against the build`;
}

// Runs the checks. `targets` are the legacy origins ({ origin, upgradeOrigin
// }, upgradeOrigin null to skip http), `request` asks them, and
// `destinationRequest` asks `destinationOrigin`. Returns every check's
// { group, url, problem } (problem null when it passed) and the records.
export async function verifyCutover({
	targets,
	request,
	destinationOrigin,
	destinationRequest,
	sample = false,
	now = Date.now(),
	map = readLegacyJson("url-map.json"),
	union = readLegacyJson("url-union.json"),
}) {
	const rows = sample ? sampleRows(map) : map.rows;
	const tasks = [];
	const recordTasks = [];
	const seen = new Set();
	const legacy = [
		...legacyProbes(rows, { map, union, now }),
		...(sample ? [] : queryProbes(map)),
	];
	for (const { origin, upgradeOrigin } of targets) {
		for (const [group, path, expectation] of legacy) {
			const [pathname, query] = path.split("?");
			const url = withQuery(`${origin}${encodePath(pathname)}`, query);
			if (seen.has(url)) {
				continue;
			}
			seen.add(url);
			tasks.push(runCheck(request, group, url, expectation));
			if (upgradeOrigin) {
				const httpUrl = withQuery(
					`${upgradeOrigin}${encodePath(pathname)}`,
					query,
				);
				tasks.push(runUpgrade(request, httpUrl, url, expectation));
			}
		}
		if (!sample) {
			for (const path of doubleSlashPaths(map)) {
				recordTasks.push(recordHops(request, `${origin}${path}`));
			}
		}
	}
	const destinations = destinationProbes(rows);
	if (sample) {
		destinations.push([
			"security.txt",
			JSOLLY_SECURITY_TXT,
			servedExpectation(join(ROOT, "public", JSOLLY_SECURITY_TXT), {
				securityTxt: true,
				now,
			}),
		]);
	}
	for (const [group, path, expectation] of destinations) {
		tasks.push(
			runCheck(
				destinationRequest,
				group,
				`${destinationOrigin}${path}`,
				expectation,
			),
		);
	}
	const results = await pool(tasks, CONCURRENCY);
	const records = await pool(recordTasks, CONCURRENCY);
	if (targets.length > 0 && !sample) {
		records.push(
			`url-union.json: ${servedIndexForms(union).length} served index.html forms probed`,
			fragmentRecord(),
		);
	}
	return { results, records };
}

// Node fetch with redirects off; `headers` go on every request.
export function fetchTransport(headers = {}) {
	return async (url, { body }) => {
		const response = await fetch(url, {
			redirect: "manual",
			headers,
			signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
		});
		const answer = {
			status: response.status,
			location: response.headers.get("location"),
			contentType: response.headers.get("content-type"),
			cacheControl: response.headers.get("cache-control"),
		};
		if (body) {
			answer.body = Buffer.from(await response.arrayBuffer());
		} else {
			await response.body?.cancel();
		}
		return answer;
	};
}

function curlArgs(url, cwd, output) {
	return [
		"curl",
		url,
		"--scope",
		VERCEL_SCOPE,
		"--cwd",
		cwd,
		"--",
		"-sS",
		"-o",
		output,
		"--max-redirs",
		"0",
		"--max-time",
		String(TIMEOUT_SECONDS),
		"-w",
		CURL_WRITE_OUT,
	];
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(`vercel curl exited ${code}: ${stderr.trim()}`));
			}
		});
	});
}

// `vercel curl` from the repo's pinned CLI, in an empty working directory.
function vercelCurlTransport(scratch) {
	const cwd = mkdtempSync(join(scratch, "cwd-"));
	let files = 0;
	return async (url, { body }) => {
		files += 1;
		const output = body ? join(scratch, `body-${files}`) : "/dev/null";
		const stdout = await run(VERCEL_BIN, curlArgs(url, cwd, output));
		const lines = stdout.slice(stdout.lastIndexOf(CURL_MARKER)).split("\n");
		if (lines[0] !== CURL_MARKER || lines.length < 5) {
			throw new Error(`unreadable curl write-out: ${JSON.stringify(stdout)}`);
		}
		const [, status, location, contentType, cacheControl] = lines;
		const answer = {
			status: Number(status),
			location: location || null,
			contentType: contentType || null,
			cacheControl: cacheControl || null,
		};
		if (body) {
			answer.body = readFileSync(output);
			rmSync(output, { force: true });
		}
		return answer;
	};
}

function parseCli(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			production: { type: "boolean", default: false },
			sample: { type: "boolean", default: false },
			"destinations-only": { type: "boolean", default: false },
			"base-url": { type: "string" },
			transport: { type: "string", default: "fetch" },
			"bypass-env": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const baseUrl = values["base-url"];
	if (values.production === (baseUrl !== undefined)) {
		throw new Error("pass exactly one of --production and --base-url");
	}
	if (!["fetch", "vercel-curl"].includes(values.transport)) {
		throw new Error(`unknown --transport ${values.transport}`);
	}
	if (values.production && values.transport !== "fetch") {
		throw new Error("--production probes public hosts with fetch only");
	}
	if (values["bypass-env"] && (!baseUrl || values.transport !== "fetch")) {
		throw new Error("--bypass-env needs --base-url and the fetch transport");
	}
	if (values["destinations-only"] && values.sample) {
		throw new Error("--sample is a legacy-host mode, not --destinations-only");
	}
	let base = null;
	if (baseUrl) {
		base = new URL(baseUrl);
		if (base.pathname !== "/" || base.search || base.hash) {
			throw new Error(`--base-url ${baseUrl} must be an origin`);
		}
	}
	return { ...values, base };
}

function bypassHeaders(name) {
	if (!name) {
		return {};
	}
	const secret = process.env[name];
	if (!secret) {
		throw new Error(`environment variable ${name} is empty`);
	}
	return { "x-vercel-protection-bypass": secret };
}

function report({ results, records }, out) {
	const failures = results.filter((result) => result.problem);
	for (const { group, url, problem } of failures) {
		out(`✗ ${group} ${url}: ${problem}`);
	}
	for (const group of GROUPS) {
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

async function main(argv) {
	let options;
	let bypass;
	try {
		options = parseCli(argv);
		bypass = bypassHeaders(options["bypass-env"]);
	} catch (error) {
		console.error(`✗ ${error.message}\n${USAGE}`);
		return 2;
	}
	const map = readLegacyJson("url-map.json");
	const scratch = mkdtempSync(join(tmpdir(), "verify-blogthedata-cutover-"));
	try {
		let baseRequest = null;
		if (options.base) {
			if (options.transport === "vercel-curl") {
				const shown = curlArgs("<url>", "<empty temp dir>", "<file|/dev/null>");
				console.log(
					`Each probe runs: ${VERCEL_BIN} ${shown.map((arg) => JSON.stringify(arg)).join(" ")}`,
				);
				baseRequest = vercelCurlTransport(scratch);
			} else {
				baseRequest = fetchTransport(bypass);
			}
		}
		const publicFetch = fetchTransport();
		const origin = options.base?.origin;
		let plan;
		if (options["destinations-only"]) {
			console.log(`Checking the url-map destinations on ${origin}.`);
			plan = {
				targets: [],
				request: baseRequest,
				destinationOrigin: origin,
				destinationRequest: baseRequest,
			};
		} else if (options.production) {
			const hosts = map.meta.hosts;
			console.log(
				`Checking ${options.sample ? "the sample of " : ""}url-map.json on ${hosts.join(", ")} (https and http); destinations on ${JSOLLY_ORIGIN}.`,
			);
			plan = {
				targets: hosts.map((host) => ({
					origin: `https://${host}`,
					upgradeOrigin: `http://${host}`,
				})),
				request: publicFetch,
				destinationOrigin: JSOLLY_ORIGIN,
				destinationRequest: publicFetch,
			};
		} else {
			console.log(
				`Checking ${options.sample ? "the sample of " : ""}url-map.json on ${origin}; destinations on ${JSOLLY_ORIGIN}.`,
			);
			plan = {
				targets: [{ origin, upgradeOrigin: null }],
				request: baseRequest,
				destinationOrigin: JSOLLY_ORIGIN,
				destinationRequest: publicFetch,
			};
		}
		const result = await verifyCutover({
			...plan,
			sample: options.sample,
			map,
		});
		return report(result, console.log);
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
