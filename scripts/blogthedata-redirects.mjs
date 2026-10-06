// Generates and checks legacy/blogthedata/vercel.json, the config of the
// redirect-only Vercel project `blogthedata` (option A′ of the blogthedata merge
// plan). legacy/blogthedata/url-map.json is the source of truth: edit it, run
// `npm run redirects:write`, and the gate's `npm run redirects:check` fails
// whenever vercel.json no longer equals what the map generates.
//
// Redirect rows are host-agnostic exact paths that 301 straight to
// https://www.jsolly.com. A page row (source ending in "/") is emitted as
// `<base>{/index.html}?{/}?`, so the slashless, slash, /index.html and
// /index.html/ forms all take one hop. serve-200 rows are real files under
// legacy/blogthedata/public; stays-404 rows emit nothing and fall through to
// public/404.html. Rows of class "service-worker" also get the no-cache
// JavaScript headers. The helpers below also compile the config with Vercel's own
// router library so the tests route paths exactly as Vercel would.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { getTransformedRoutes } from "@vercel/routing-utils";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const LEGACY_DIR = join(ROOT, "legacy", "blogthedata");
export const JSOLLY_ORIGIN = "https://www.jsolly.com";
const ACTIONS = new Set(["redirect-301", "serve-200", "stays-404"]);
// path-to-regexp syntax that would turn an exact source into a pattern.
const PATTERN_SYNTAX = /[:*?+(){}\\]/u;
// Vercel interpolates `$1` and `:param` into a redirect destination.
const DESTINATION_PARAM = /[$:]/u;
const UPPERCASE = /[A-Z]/u;

const SECURITY_HEADERS = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-Frame-Options", value: "DENY" },
	{
		key: "Content-Security-Policy",
		value:
			"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
	},
];
export const SERVICE_WORKER_HEADERS = [
	{ key: "Content-Type", value: "application/javascript; charset=utf-8" },
	{ key: "Cache-Control", value: "no-cache" },
];

export function readLegacyJson(name, dir = LEGACY_DIR) {
	return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

export function isPageRow(row) {
	return row.source.endsWith("/") && row.source !== "/";
}

// The paths one exact redirect row answers: a page row also answers its
// slashless, /index.html and /index.html/ forms.
export function redirectForms(row) {
	if (!isPageRow(row)) {
		return [row.source];
	}
	const base = row.source.slice(0, -1);
	return [row.source, base, `${base}/index.html`, `${base}/index.html/`];
}

// The known paths one row answers, as probes: every form of a redirect row;
// a pattern row's samples (it must carry some); an exact page row's slash and
// slashless forms; any other row's exact source.
export function probePaths(row) {
	if (row.action === "redirect-301") {
		return redirectForms(row);
	}
	if (row.match === "pattern") {
		if (!(row.samples?.length > 0)) {
			throw new Error(`url-map pattern row ${row.id} has no samples`);
		}
		return row.samples;
	}
	return isPageRow(row) ? [row.source, row.source.slice(0, -1)] : [row.source];
}

// The lowercase variants of mixed-case redirect sources that no row owns:
// matching is case-sensitive, so each must stay 404.
export function lowercaseNegatives(rows) {
	const sources = new Set(rows.map((row) => row.source));
	return rows
		.filter(
			(row) => row.action === "redirect-301" && UPPERCASE.test(row.source),
		)
		.map((row) => row.source.toLowerCase())
		.filter((source) => !sources.has(source));
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

function redirectSource(row) {
	return isPageRow(row)
		? `${row.source.slice(0, -1)}{/index.html}?{/}?`
		: row.source;
}

function assertValidMap(rows) {
	const sources = new Set();
	for (const row of rows) {
		if (!ACTIONS.has(row.action)) {
			throw new Error(`url-map row ${row.id} has unknown action ${row.action}`);
		}
		if (sources.has(row.source)) {
			throw new Error(`url-map has two rows for ${row.source}`);
		}
		sources.add(row.source);
		if (row.match === "exact" && PATTERN_SYNTAX.test(row.source)) {
			throw new Error(
				`url-map row ${row.id} is exact but its source ${row.source} has pattern syntax`,
			);
		}
		if (Object.hasOwn(row, "has")) {
			throw new Error(
				`url-map row ${row.id} carries a host condition; every row is host-agnostic`,
			);
		}
		if (row.action !== "redirect-301") {
			continue;
		}
		// A pattern redirect could send an unknown filename to a jsolly.com 404.
		if (row.match !== "exact") {
			throw new Error(
				`url-map row ${row.id} is a ${row.match} redirect; redirects must be exact`,
			);
		}
		if (!row.destination.startsWith(`${JSOLLY_ORIGIN}/`)) {
			throw new Error(
				`url-map row ${row.id} redirects to ${row.destination}, outside ${JSOLLY_ORIGIN}`,
			);
		}
		if (DESTINATION_PARAM.test(row.destination.slice(JSOLLY_ORIGIN.length))) {
			throw new Error(
				`url-map row ${row.id} destination ${row.destination} has a parameter Vercel would interpolate`,
			);
		}
	}
}

export function vercelConfig(map) {
	assertValidMap(map.rows);
	return {
		$schema: "https://openapi.vercel.sh/vercel.json",
		framework: null,
		installCommand: "",
		buildCommand: "",
		outputDirectory: "public",
		git: {
			deploymentEnabled: {
				main: true,
				"*": false,
				"*/*": false,
				"*/*/*": false,
				"*/*/*/*": false,
				"**": false,
			},
		},
		headers: [
			{ source: "/(.*)", headers: SECURITY_HEADERS },
			...map.rows
				.filter((row) => row.class === "service-worker")
				.map((row) => ({
					source: row.source,
					headers: SERVICE_WORKER_HEADERS,
				})),
		],
		redirects: map.rows
			.filter((row) => row.action === "redirect-301")
			.map((row) => ({
				source: redirectSource(row),
				destination: row.destination,
				statusCode: 301,
			})),
	};
}

// Returns null when vercel.json equals the generated config, else what differs.
export function vercelJsonDrift(dir = LEGACY_DIR) {
	const expected = vercelConfig(readLegacyJson("url-map.json", dir));
	const actual = readLegacyJson("vercel.json", dir);
	if (isDeepStrictEqual(actual, expected)) {
		return null;
	}
	const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
	const differing = [...keys].filter(
		(key) => !isDeepStrictEqual(actual[key], expected[key]),
	);
	return `vercel.json differs from what url-map.json generates in: ${differing.join(", ")}`;
}

// Vercel's compiled routes (pre-filesystem phase) for a vercel.json object.
export function compileRoutes(config) {
	const { routes, error } = getTransformedRoutes({
		redirects: config.redirects,
		headers: config.headers,
		trailingSlash: config.trailingSlash,
	});
	if (error) {
		throw new Error(`routing-utils rejected vercel.json: ${error.message}`, {
			cause: error,
		});
	}
	return routes.map((route) => ({
		...route,
		regex: route.src ? new RegExp(route.src, "u") : null,
	}));
}

// The jsolly.com project's own vercel.json (the repo root's), compiled.
// routePath ignores `has`, so the apex-host redirect (it only answers
// jsolly.com) stays out.
export function rootVercelRoutes() {
	const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
	return compileRoutes({
		...config,
		redirects: config.redirects.filter((redirect) => !redirect.has),
	});
}

// Walks the compiled routes in order, as Vercel does before its filesystem
// phase: header routes continue and accumulate headers, the first redirect
// answers. `redirectHits` counts every redirect route the path matches.
export function routePath(routes, pathname) {
	const headers = {};
	let redirect = null;
	let redirectHits = 0;
	for (const route of routes) {
		if (!route.regex?.test(pathname)) {
			continue;
		}
		if (route.status) {
			redirectHits += 1;
			redirect ??= { status: route.status, location: route.headers.Location };
		} else if (redirect === null && route.continue) {
			Object.assign(headers, route.headers);
		}
	}
	return { redirect, headers, redirectHits };
}

function write() {
	const config = vercelConfig(readLegacyJson("url-map.json"));
	// Tab-indented JSON.stringify output is already Biome's JSON format.
	writeFileSync(
		join(LEGACY_DIR, "vercel.json"),
		`${JSON.stringify(config, null, "\t")}\n`,
	);
	console.log(
		`✓ wrote legacy/blogthedata/vercel.json (${config.redirects.length} redirects).`,
	);
	return 0;
}

function check() {
	const drift = vercelJsonDrift();
	if (drift) {
		console.error(
			`✗ legacy/blogthedata/${drift}. Run \`npm run redirects:write\` and commit the result.`,
		);
		return 1;
	}
	console.log(
		"✓ legacy/blogthedata/vercel.json matches legacy/blogthedata/url-map.json.",
	);
	return 0;
}

function main(mode) {
	if (mode === "--write") {
		return write();
	}
	if (mode === "--check") {
		return check();
	}
	console.error(
		"usage: node scripts/blogthedata-redirects.mjs --write|--check",
	);
	return 2;
}

// Compare real paths: import.meta.url is the realpath, argv[1] may be a symlink.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exitCode = main(process.argv[2]);
}
