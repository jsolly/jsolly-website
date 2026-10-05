// Cross-check of out/legacy-blogthedata-vercel.json against the REAL Vercel compiler
// (@vercel/routing-utils 6.6.0), independent of the map script's own matcher.
// Prototype of the PA6 compile test (scripts/unit/blogthedata-redirects.test.mjs), which
// supersedes it; this script retires at PA6.
//
// Usage (any cwd; the install dir is outside the repo so no lockfile changes):
//   npm i --prefix <dir> @vercel/routing-utils@6.6.0
//   ROUTING_UTILS_DIR=<dir> node exp/compile-check.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.dirname(HERE);
const require = createRequire(import.meta.url);
const INSTALL_HINT = "npm i --prefix <dir> @vercel/routing-utils@6.6.0, then rerun with ROUTING_UTILS_DIR=<dir>";
const ruDir = process.env.ROUTING_UTILS_DIR;
if (!ruDir) {
	console.error(`ROUTING_UTILS_DIR is not set. Install the compiler outside the repo: ${INSTALL_HINT}`);
	process.exit(2);
}
const ruPkgPath = path.join(ruDir, "node_modules/@vercel/routing-utils/package.json");
if (!existsSync(ruPkgPath)) {
	console.error(`No @vercel/routing-utils under ${ruDir}/node_modules. ${INSTALL_HINT}`);
	process.exit(2);
}
const ruPkg = JSON.parse(readFileSync(ruPkgPath, "utf8"));
if (ruPkg.version !== "6.6.0") {
	console.error(`@vercel/routing-utils under ${ruDir} is ${ruPkg.version}, expected 6.6.0. ${INSTALL_HINT}`);
	process.exit(2);
}
const ru = require(path.join(ruDir, "node_modules/@vercel/routing-utils"));

const vercel = JSON.parse(readFileSync(path.join(BASE, "out/legacy-blogthedata-vercel.json"), "utf8"));
const map = JSON.parse(readFileSync(path.join(BASE, "out/url-map.json"), "utf8"));
const union = JSON.parse(readFileSync(path.join(BASE, "out/url-map-union.json"), "utf8"));
const rowsById = new Map(map.rows.map((r) => [r.id, r]));

const { routes, error } = ru.getTransformedRoutes({
	redirects: vercel.redirects,
	headers: vercel.headers,
	trailingSlash: vercel.trailingSlash,
});
if (error) {
	console.error("COMPILE ERROR", error);
	process.exit(1);
}

// Minimal router: walk compiled routes in order (Vercel's pre-filesystem phase).
function route(pathname) {
	const hits = [];
	for (const r of routes) {
		if (r.handle) break; // everything we care about precedes the filesystem phase
		if (!r.src) continue;
		const re = new RegExp(r.src); // no flags: case-sensitive like the compiled source
		const m = re.exec(pathname);
		if (!m) continue;
		if (r.status && r.headers?.Location) {
			let loc = r.headers.Location;
			loc = loc.replace(/\$(\d+)/gu, (_x, n) => m[Number(n)] ?? "");
			if (m.groups) for (const [k, v] of Object.entries(m.groups)) loc = loc.replaceAll(`$${k}`, v ?? "");
			hits.push({ status: r.status, location: loc });
			return { outcome: "redirect", status: r.status, location: loc, hits };
		}
		if (r.continue) continue;
		return { outcome: "stop", hits }; // e.g. ^/\.well-known route: filesystem only
	}
	return { outcome: "filesystem", hits };
}

const expectFor = (row, probe) => {
	if (row.action !== "redirect-301") return { redirect: false };
	if (row.match === "exact") return { redirect: true, location: row.destination };
	// pattern rows: substitute captured params the way Vercel does
	const params = row.source.match(/:[A-Za-z_]\w*/gu) ?? [];
	const re = new RegExp(`^${row.source.replace(/[.]/gu, "\\.").replace(/:[A-Za-z_]\w*/gu, "([^/]+?)")}$`, "u");
	const m = re.exec(probe);
	let d = row.destination;
	params.forEach((p, i) => {
		d = d.replace(p, m[i + 1]);
	});
	return { redirect: true, location: d };
};

const problems = [];
const redirectRoutes = routes.filter((r) => r.src && r.status);
let multiMatch = 0;
const countRedirectMatches = (p) => redirectRoutes.filter((r) => new RegExp(r.src).test(p)).length;
let redirectsOk = 0;
let nonRedirectOk = 0;
let slashFormsOk = 0;
let lowercaseNegatives = 0;
for (const el of union.elements) {
	if (el.kind === "host-rule") continue;
	const row = rowsById.get(el.row_id);
	const got = route(el.probe);
	if (countRedirectMatches(el.probe) > 1) {
		multiMatch++;
		problems.push(`${el.probe}: matched by more than one compiled redirect route`);
	}
	const want = expectFor(row, el.probe);
	if (want.redirect) {
		if (got.outcome !== "redirect" || got.status !== 301 || got.location !== want.location) {
			problems.push(`${el.probe}: want 301 ${want.location}, got ${JSON.stringify(got)}`);
		} else redirectsOk++;
	} else if (got.outcome === "redirect") {
		problems.push(`${el.probe}: ${row.action} row ${row.id} but compiled redirect ${got.location}`);
	} else nonRedirectOk++;
}
// Both slash forms for every exact redirect row with a trailing-slash source.
for (const r of map.rows) {
	if (r.action !== "redirect-301" || r.match !== "exact") continue;
	const forms =
		r.source.endsWith("/") && r.source !== "/"
			? [r.source, r.source.slice(0, -1), `${r.source}index.html`, `${r.source}index.html/`]
			: [r.source];
	for (const f of forms) {
		const got = route(f);
		if (got.outcome !== "redirect" || got.status !== 301 || got.location !== r.destination) {
			problems.push(`slash form ${f}: ${JSON.stringify(got)}`);
		} else slashFormsOk++;
	}
	// Case: lowercase variants of mixed-case sources must not redirect (they 404 today).
	if (/[A-Z]/u.test(r.source)) {
		const lower = r.source.toLowerCase();
		if (!map.rows.some((x) => x.source === lower)) {
			const got = route(lower);
			if (got.outcome === "redirect") problems.push(`lowercase ${lower} redirects: ${got.location}`);
			else lowercaseNegatives++;
		}
	}
}
// Negatives: near-miss shapes that must never redirect (review findings MU-1, MU-4).
const negatives = [
	"/post/conventional-commitsindex.html",
	"/post/conventional-commits/index.htm",
	"/post/conventional-commits/service-worker.js",
	"/post/conventional-commits/index.html/x",
	"/media/recipes/does-not-exist.webp",
	"/recipes-pwa/does-not-exist.png",
	"/recipes",
	"/recipes/index.html/",
];
let negativesOk = 0;
for (const n of negatives) {
	const got = route(n);
	// /recipes and /recipes/index.html/ are legitimate forms of the opted-in /recipes/ row.
	const allowed = n === "/recipes" || n === "/recipes/index.html/";
	if (allowed) {
		if (got.outcome === "redirect" && got.location === "https://www.jsolly.com/recipes/") negativesOk++;
		else problems.push(`form ${n} of /recipes/: ${JSON.stringify(got)}`);
	} else if (got.outcome === "redirect") problems.push(`negative ${n} redirects to ${got.location}`);
	else negativesOk++;
}
// Kill-switch and served files are never redirected.
for (const r of map.rows.filter((x) => x.action === "serve-200")) {
	const got = route(r.source);
	if (got.outcome === "redirect") problems.push(`serve-200 ${r.source} redirected`);
}

const report = [
	`routing-utils ${ruPkg.version}: compiled ${routes.length} routes from ${vercel.redirects.length} redirects + ${vercel.headers.length} header rules`,
	`union elements routed: ${union.elements.length - 1} (host-scope element excluded)`,
	`  redirect rows -> exactly one compiled 301 with the expected Location: ${redirectsOk}`,
	`  serve-200/stays-404 rows -> no compiled redirect: ${nonRedirectOk}`,
	`exact redirect rows, every form (slash, slashless, /index.html, /index.html/) -> 301 + Location: ${slashFormsOk}`,
	`near-miss probes behaving as expected: ${negativesOk}/${negatives.length}`,
	`lowercase variants of mixed-case sources -> no redirect (case-sensitive): ${lowercaseNegatives}`,
	`union elements matched by more than one compiled redirect route: ${multiMatch}`,
	`compiled route kinds: ${JSON.stringify(routes.reduce((a, r) => { const k = r.handle ? `handle:${r.handle}` : r.status ? `redirect-${r.status}` : r.continue ? "header(continue)" : "stop"; a[k] = (a[k] ?? 0) + 1; return a; }, {}))}`,
	`problems: ${problems.length}`,
	...problems.map((p) => `  ${p}`),
].join("\n");
writeFileSync(path.join(BASE, "out/compile-check.txt"), `${report}\n`);
console.log(report);
if (problems.length) process.exit(1);
