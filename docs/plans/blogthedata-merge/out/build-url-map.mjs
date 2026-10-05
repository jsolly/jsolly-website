#!/usr/bin/env node
// Deterministic URL-map generator for the blogthedata.com -> jsolly.com merge plan.
//
// Node built-ins only. Reads the discovery evidence next to this directory plus SRC
// (awesome-blog) config through `git show`/`git ls-tree` (never the SRC filesystem),
// applies the decisions brief (decisions-brief.md, amendments A1-A8), and writes:
//   out/url-map.json               the map ({meta, rows}); becomes legacy/blogthedata/url-map.json
//   out/url-map.md                 human-readable appendix
//   out/url-map-check.txt          mechanical union check (also printed)
//   out/url-map-destinations.json  every jsolly.com destination path (existence-test input)
//   out/legacy-blogthedata-vercel.json  preview of the generated redirect-host vercel.json
//
// Exit code 1 when UNMATCHED > 0, AMBIGUOUS > 0, a destination falls outside the
// expected merged-site layout, or any structural assertion fails.
//
// Usage: node out/build-url-map.mjs [--src-ref <ref>] [--expect-sha <sha>]
// Both default to the pinned freeze-plan SHA bf1f7ff1, so the run reproduces after
// awesome-blog main moves (B00's freeze PR moves it). SRC_REPO/DST_REPO env vars
// override the checkout paths.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.dirname(OUT);
const SRC_REPO = process.env.SRC_REPO ?? "/Users/johnsolly/code/awesome-blog";
const DST_REPO = process.env.DST_REPO ?? "/Users/johnsolly/code/jsolly-website";
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const SRC_REF = argValue("--src-ref", "bf1f7ff1cb92faacfdc3b98ba17fb2f93cac59b5");
const EXPECT_SHA = argValue(
	"--expect-sha",
	"bf1f7ff1cb92faacfdc3b98ba17fb2f93cac59b5",
);
const JSOLLY = "https://www.jsolly.com";
const OLD_HOSTS = new Set(["blogthedata.com", "www.blogthedata.com"]);

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------- SRC facts (git only)
const git = (repo, ...a) =>
	execFileSync("git", ["-C", repo, ...a], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
const SOURCE_SHA = git(SRC_REPO, "rev-parse", SRC_REF).trim();
if (EXPECT_SHA && SOURCE_SHA !== EXPECT_SHA) {
	fail(`SRC ${SRC_REF} is ${SOURCE_SHA}, expected ${EXPECT_SHA}`);
}
const lsTree = (dir) =>
	git(SRC_REPO, "ls-tree", "--name-only", SOURCE_SHA, `${dir}/`)
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((p) => p.slice(dir.length + 1));
const showJson = (p) => JSON.parse(git(SRC_REPO, "show", `${SOURCE_SHA}:${p}`));

const POST_SLUGS = lsTree("src/content/posts")
	.filter((f) => f.endsWith(".md"))
	.map((f) => f.slice(0, -3))
	.sort();
const CATEGORY_SLUGS = lsTree("src/content/categories")
	.filter((f) => f.endsWith(".json"))
	.map((f) => f.slice(0, -5))
	.sort();
const RECIPE_IDS = showJson("src/components/recipes/recipes.json")
	.recipes.map((r) => r.id)
	.sort();
const RECIPE_MEDIA = lsTree("public/media/recipes").sort();
const RECIPE_PWA = lsTree("public/recipes-pwa").sort();
const SOCIAL = lsTree("public/social").sort();
const SRC_VERCEL = showJson("vercel.json");
const SRC_REDIRECTS = showJson("src/content/redirects.json");
const DST_FILES = new Set(git(DST_REPO, "ls-files").trim().split("\n"));

const RECIPE_POST = "15-minute-dump-and-go-instant-pot-recipes";
const CLOSED_LOOPS_TARGET = "how-to-ask-less-questions";
if (!POST_SLUGS.includes(CLOSED_LOOPS_TARGET)) {
	fail(`closed-loops target ${CLOSED_LOOPS_TARGET} is not a SRC post`);
}
if (POST_SLUGS.length !== 106) fail(`expected 106 posts, got ${POST_SLUGS.length}`);
if (CATEGORY_SLUGS.length !== 6) fail(`expected 6 categories, got ${CATEGORY_SLUGS.length}`);
if (RECIPE_IDS.length !== 21) fail(`expected 21 recipes, got ${RECIPE_IDS.length}`);
if (POST_SLUGS.some((s) => /^\d+$/u.test(s))) {
	fail("an all-digit post slug would overlap the Django /post/<int:pk>/ row");
}

// ---------------------------------------------------------------- normalization
const decodePath = (p) =>
	p
		.split("/")
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");

/** -> {kind:'path'|'template'|'host-rule', path, query} */
function normalize(raw) {
	const s = String(raw).trim();
	if (s.startsWith("http(s)://")) return { kind: "host-rule", path: s, query: "" };
	let pathPart = s;
	let query = "";
	if (/^https?:\/\//u.test(s)) {
		const u = new URL(s);
		if (!OLD_HOSTS.has(u.hostname)) fail(`foreign host in evidence: ${s}`);
		pathPart = u.pathname;
		query = u.search.replace(/^\?/u, "");
	} else {
		const hashAt = pathPart.indexOf("#");
		if (hashAt !== -1) pathPart = pathPart.slice(0, hashAt);
		const qAt = pathPart.indexOf("?");
		if (qAt !== -1) {
			query = pathPart.slice(qAt + 1);
			pathPart = pathPart.slice(0, qAt);
		}
	}
	if (!pathPart.startsWith("/")) pathPart = `/${pathPart}`;
	const p = decodePath(pathPart);
	if (/<[^>]+>/u.test(p)) return { kind: "template", path: p, query };
	return { kind: "path", path: p, query };
}

// Deterministic sample values for Django route templates (<type:name> converters).
function instantiateTemplate(t) {
	return t.replace(/<(?:(?<conv>\w+):)?(?<name>\w+)>/gu, (_m, conv, name) => {
		if (conv === "int") return "0";
		if (conv === "slug") return "x-sample-slug";
		if (name === "uidb64") return "MQ";
		if (name === "token") return "x-token";
		return "x-sample";
	});
}

// ---------------------------------------------------------------- union U
const union = new Map(); // key kind|path -> element
function addElement(raw, evidence, host) {
	const n = normalize(raw);
	const key = `${n.kind}|${n.path}`;
	let el = union.get(key);
	if (!el) {
		el = {
			kind: n.kind,
			path: n.path,
			queries: new Set(),
			evidence: new Set(),
			hosts: new Set(),
		};
		union.set(key, el);
	}
	if (n.query) el.queries.add(n.query);
	for (const e of evidence) el.evidence.add(e);
	if (host) el.hosts.add(host);
}
const LIVE_SOURCE = {
	crawl: "crawl",
	probe: "live",
	sitemap: "sitemap",
	rss: "rss",
	atom: "atom",
	wayback: "wayback",
	robots: "live",
	"well-known": "live",
	"redirect-config": "config",
};
const HISTORY_SOURCE = {
	wayback: "wayback",
	"git-history": "django-routes",
	"migration-docs": "history",
	"migration-export": "history",
	"redirect-config": "config",
	"search-engine": "history",
};
const readJson = (f) => JSON.parse(readFileSync(path.join(BASE, f), "utf8"));
const BUILD = readJson("urls-build.json");
const LIVE = readJson("urls-live.json");
const HISTORY = readJson("urls-history.json");
const SITEMAP = readFileSync(path.join(BASE, "sitemap-locs.txt"), "utf8")
	.split("\n")
	.map((l) => l.trim())
	.filter(Boolean);
// Every file Vercel serves from the bf1f7ff1 dist, un-normalized (so `/<page>/index.html`
// forms are present; urls-build.json folded them into slash form). Review finding MU-1.
const SERVED = readFileSync(path.join(BASE, "served-files.txt"), "utf8")
	.split("\n")
	.map((l) => l.trim())
	.filter(Boolean);
const LIVE_200 = new Set(LIVE.filter((r) => r.status === 200).map((r) => decodePath(r.path)));
const inputCounts = {
	build_rows: BUILD.length,
	served_files: SERVED.length,
	live_rows: LIVE.length,
	history_rows: HISTORY.length,
	sitemap_locs: SITEMAP.length,
	config_entries: 0,
};
for (const r of BUILD) addElement(r.path, ["build"], null);
for (const p of SERVED) addElement(p, ["served"], null);
for (const r of LIVE) {
	const ev = new Set(["live"]);
	for (const s of [r.source, ...(r.sources ?? [])]) {
		if (LIVE_SOURCE[s]) ev.add(LIVE_SOURCE[s]);
	}
	addElement(r.path, ev, r.host);
}
for (const r of HISTORY) {
	const ev = new Set(["history"]);
	for (const s of r.sources ?? []) if (HISTORY_SOURCE[s]) ev.add(HISTORY_SOURCE[s]);
	addElement(r.path, ev, null);
}
for (const loc of SITEMAP) addElement(loc, ["sitemap"], new URL(loc).hostname);
for (const r of SRC_VERCEL.redirects ?? []) {
	inputCounts.config_entries++;
	if ((r.has ?? []).some((h) => h.type === "host")) {
		addElement("http(s)://blogthedata.com/<any>", ["config"], null);
	} else {
		addElement(r.source, ["config"], null);
		addElement(r.destination, ["config"], null);
	}
}
for (const r of SRC_REDIRECTS) {
	inputCounts.config_entries++;
	addElement(r.source, ["config"], null);
	addElement(r.destination, ["config"], null);
}

// ---------------------------------------------------------------- source pattern compiler
// Subset of path-to-regexp v6 with Vercel's options {strict:true, sensitive:true}.
// Supported: literals, `:name`, `:name*`, `:name(re)` (no capturing groups in re), `{/}?`.
// Anything else throws, so a later edit cannot silently stop matching.
const LITERAL = /[A-Za-z0-9_.~\-/ ]/u;
const escapeRe = (c) => c.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
function compileSource(source) {
	let re = "";
	let i = 0;
	const names = [];
	while (i < source.length) {
		const c = source[i];
		if (source.startsWith("{/}?", i)) {
			re += "(?:/)?";
			i += 4;
			continue;
		}
		if (c === ":") {
			const m = /^:(?<name>[A-Za-z_]\w*)/u.exec(source.slice(i));
			if (!m) throw new Error(`bad parameter in ${source} at ${i}`);
			const name = m.groups.name;
			names.push(name);
			i += m[0].length;
			let inner = "[^/]+?";
			if (source[i] === "(") {
				let depth = 0;
				let j = i;
				for (; j < source.length; j++) {
					if (source[j] === "\\") {
						j++;
						continue;
					}
					if (source[j] === "(") depth++;
					if (source[j] === ")" && --depth === 0) break;
				}
				if (depth !== 0) throw new Error(`unbalanced group in ${source}`);
				inner = source.slice(i + 1, j);
				if (/\((?!\?)/u.test(inner)) {
					throw new Error(`capturing group inside parameter in ${source}`);
				}
				i = j + 1;
			}
			if (source[i] === "*") {
				// path-to-regexp: a preceding "/" becomes the optional group's prefix
				if (!re.endsWith("/")) throw new Error(`:${name}* must follow "/" in ${source}`);
				re = re.slice(0, -1);
				re += `(?:/(${inner}(?:/${inner})*))?`;
				i++;
			} else {
				re += `(${inner})`;
			}
			continue;
		}
		if (!LITERAL.test(c)) throw new Error(`unsupported token "${c}" in ${source}`);
		re += escapeRe(c);
		i++;
	}
	return { regex: new RegExp(`^${re}$`, "u"), names };
}

// ---------------------------------------------------------------- rows
const rows = [];
const ABS = (p) => `${JSOLLY}${p}`;
function row(spec) {
	const r = {
		id: "",
		source: spec.source,
		match: spec.match ?? "exact",
		class: spec.class,
		action: spec.action,
		destination: spec.destination ?? null,
		query: "passthrough",
		evidence: [],
		decision_ref: spec.decision_ref ?? null,
		notes: spec.notes ?? "",
	};
	if (r.match === "pattern") {
		r._compiled = compileSource(spec.source);
	}
	rows.push(r);
	return r;
}
const redirect = (source, cls, destPath, extra = {}) =>
	row({ source, class: cls, action: "redirect-301", destination: ABS(destPath), ...extra });
const gone = (source, cls, extra = {}) =>
	row({ source, class: cls, action: "stays-404", destination: null, ...extra });
const serve = (source, cls, file, extra = {}) =>
	row({ source, class: cls, action: "serve-200", destination: file, ...extra });

// Index, archive, search, misc pages
redirect("/", "index", "/blog/", {
	notes: "Blog home. Required by Search Console Change of Address (old homepage must 301).",
});
redirect("/index.html", "index", "/blog/", {
	notes: "Vercel serves dist/index.html directly today (200). Not linked anywhere.",
});
redirect("/all-posts/", "archive", "/blog/all-posts/");
redirect("/search/", "search", "/blog/search/", {
	notes: "Query passthrough keeps ?searched=<term> (param is `searched`, not `q`).",
});
redirect("/works-cited/", "other", "/blog/works-cited/");
redirect("/privacy/", "other", "/privacy/", {
	decision_ref: "J14",
	notes: "Blog privacy statements merge into jsolly /privacy/ (recipe localStorage, SW cache).",
});

// Posts (exact case preserved), the recipe special case and the legacy aliases
for (const slug of POST_SLUGS) {
	if (slug === RECIPE_POST) continue;
	redirect(`/post/${slug}/`, "post", `/blog/${slug}/`, {
		notes: /[A-Z]/u.test(slug) ? "Mixed-case slug preserved; lowercase variants are not rows." : "",
	});
}
redirect(`/post/${RECIPE_POST}/`, "recipe-page", "/recipes/", {
	notes: "John's required special case. Hash deep links (#<recipe-id>, #meal-results) survive client-side.",
});
const aliasTarget = new Map([
	["sollys-favorite-youtube-channels-and-podcasts", "my-favorite-youtube-channels-podcasts-newsletters"],
	["how-to-leverage-closed-loops", CLOSED_LOOPS_TARGET],
]);
for (const r of SRC_REDIRECTS) {
	const from = r.source.replace(/^\/post\/|\/$/gu, "");
	if (!aliasTarget.has(from)) fail(`unexpected SRC redirect ${r.source}`);
}
redirect(
	"/post/sollys-favorite-youtube-channels-and-podcasts/",
	"legacy-alias",
	"/blog/my-favorite-youtube-channels-podcasts-newsletters/",
	{ notes: "SRC vercel.json rename, flattened to the final URL (no chain)." },
);
redirect("/post/how-to-leverage-closed-loops/", "legacy-alias", `/blog/${CLOSED_LOOPS_TARGET}/`, {
	decision_ref: "J5",
	notes: "SRC target /post/stop-asking-questions-to-save-time/ never existed (404 today, no Wayback capture). Retargeted to the nearest live post; fallback /blog/.",
});
gone("/post/stop-asking-questions-to-save-time/", "legacy-alias", {
	notes: "Dead target of the old closed-loops redirect; 404 today.",
});
gone("/post/find-your-dream-job-with-linkedin-boolean-search/", "post", {
	notes: "Lowercase probe of a mixed-case slug: 404 today, stays 404 (case-sensitive sources; negative probe for the verifier).",
});

// Categories (current + legacy slugs)
for (const slug of CATEGORY_SLUGS) {
	redirect(`/category/${slug}/`, "category", `/blog/category/${slug}/`, {
		notes: "?page=N is client-side load-more state; passes through harmlessly.",
	});
}
for (const [legacy, current] of [
	["geodev", "Geodev"],
	["devtools", "dev-tools"],
	["webdev", "web-dev"],
	["web-development", "web-dev"],
]) {
	redirect(`/category/${legacy}/`, "legacy-alias", `/blog/category/${current}/`, {
		notes: "Legacy Django-era category slug (404 today); brief opts it in.",
	});
}
gone("/category/portfolio/", "category", { decision_ref: "J10", notes: "Indexed historically; 404 today." });
const KNOWN_CATEGORY_SLUGS = [
	...CATEGORY_SLUGS,
	"geodev",
	"devtools",
	"webdev",
	"web-development",
	"portfolio",
];
row({
	source: `/category/:cat((?!(?:${KNOWN_CATEGORY_SLUGS.map(escapeRe).join("|")})/?$)[^/]+){/}?`,
	match: "pattern",
	class: "legacy-django",
	action: "stays-404",
	decision_ref: "J10",
	notes: "Django CategoryView template; every slug with evidence has its own row (excluded by the lookahead), any other slug 404s.",
});

// Feeds, sitemap, robots, security files
redirect("/rss/", "feed", "/blog/rss.xml", {
	notes: "Feed id/guid values stay the legacy blogthedata URLs inside the new feed (J8).",
});
redirect("/atom/", "feed", "/blog/atom.xml", { notes: "Atom feed <id> unchanged (J8)." });
redirect("/sitemap.xml", "sitemap", "/sitemap-index.xml");
serve("/robots.txt", "robots", "legacy/blogthedata/public/robots.txt", {
	notes: "Permissive (Allow: /, no Disallow) so crawlers can follow the 301s.",
});
serve("/.well-known/security.txt", "security", "legacy/blogthedata/public/.well-known/security.txt", {
	decision_ref: "J15",
	notes: "Vercel cannot redirect /.well-known; served file points Contact/Encryption at jsolly.com.",
});
redirect("/pgp-key.txt", "security", "/pgp-key.txt");

// Chrome assets and media
redirect("/favicon.ico", "asset-chrome", "/favicon.ico", { notes: "DST favicon wins." });
redirect("/topographic-logo.svg", "asset-chrome", "/blog/topographic-logo.svg", {
	notes: "BlogLayout header brand (SRC Base.astro:41).",
});
redirect("/logo.webp", "asset-chrome", "/blog/topographic-logo.svg", {
	notes: "Legacy logo.webp is unreferenced in SRC src/ and shares the topographic artwork (SRC docs/recipes.md:116); not ported, redirected for hot-links.",
});
for (const f of SOCIAL) {
	redirect(`/social/${f}`, "asset-chrome", `/blog/social/${f}`, {
		notes: "Used by the author card and post share buttons (SRC About.astro:8-11, post page:36).",
	});
}
redirect("/media/default.webp", "asset-media", "/blog/media/default.webp");
// Exact rows from git ls-tree (review finding MU-4): an unknown filename stays a clean 404
// instead of a 301 to a jsolly.com 404.
for (const f of RECIPE_MEDIA) {
	redirect(`/media/recipes/${f}`, "asset-media", `/recipes/media/${f}`, {
		notes: "Recipe image; one exact row per tracked file (unknown names stay 404).",
	});
}
row({
	source: "/_astro/:file",
	match: "pattern",
	class: "asset-hashed",
	action: "stays-404",
	decision_ref: "J27",
	notes: "SERVED 200 TODAY -> deliberately 404 after cutover (brief item 18; served-today ledger). Content-hashed build artifacts; the new site emits new hashes and nothing external should depend on one.",
});

// Recipes
for (const p of ["meals", "smoothies", ...RECIPE_IDS]) {
	redirect(`/recipes/${p}/`, "recipe-page", `/recipes/${p}/`, {
		notes: p === "meals" || p === "smoothies" ? "Collection page." : "Share links keep ?servings=&starch=.",
	});
}
redirect("/recipes/", "recipe-page", "/recipes/", {
	decision_ref: "J10",
	notes: "404 on the old host today (and /recipes 308s to it); recommended opt-in to the new recipes home (review finding MU-6).",
});
redirect("/data/recipe-library.json", "recipe-data", "/recipes/data/recipe-library.json", {
	notes: "Assistant data; regenerated at the new path (external consumers unverifiable).",
});
redirect("/data/recipe-library.md", "recipe-data", "/recipes/data/recipe-library.md");
for (const f of RECIPE_PWA) {
	redirect(`/recipes-pwa/${f}`, "recipe-pwa", `/recipes/pwa/${f}`, {
		notes: "Manifest or icon; one exact row per tracked file. Installed apps are origin-bound and cannot migrate.",
	});
}
serve("/recipe-service-worker.js", "service-worker", "legacy/blogthedata/public/recipe-service-worker.js", {
	notes: "Kill-switch SW (scope /). 200, application/javascript, no-cache. Never redirected: SW script fetches use redirect mode 'error'.",
});
serve(
	`/post/${RECIPE_POST}/service-worker.js`,
	"service-worker",
	`legacy/blogthedata/public/post/${RECIPE_POST}/service-worker.js`,
	{ notes: "Legacy-scope kill-switch SW; identical bytes to the root one." },
);

// Old-host files with no successor
serve("/404.html", "other", "legacy/blogthedata/public/404.html", {
	notes: "The redirect host's own static 404 page. Vercel serves output files directly, so /404.html is 200 (as today); noindex.",
});
gone("/404/", "other", { notes: "Canonical of the old 404 page; never a real URL." });
gone("/release.json", "other", {
	decision_ref: "J27",
	notes: "SERVED 200 TODAY -> deliberately 404 after cutover (brief item 18; served-today ledger). Release-proof endpoint of the old smoke; no release is served from this host any more.",
});
gone("/search-index.json", "search", {
	decision_ref: "J27",
	notes: "SERVED 200 TODAY -> deliberately 404 after cutover (brief item 18; served-today ledger). Runtime fetch of the old search page only; a cross-origin redirect would fail CORS anyway.",
});

// Retired or never-served paths (404 today, no regression)
const deleted = [
	"blogthedata-open-source-blog-portfolio",
	"family-constitution-outlines-principles-values",
	"geoasteroids",
	"part-1-adding-SEO",
	"web-mapping-gallery",
];
for (const slug of deleted) {
	gone(`/post/${slug}/`, "post", {
		decision_ref: "J10",
		notes: "Deleted before the Astro migration; 404 today. History agent proposed a topical target (opt-in).",
	});
}
redirect("/blog/", "other", "/blog/", {
	decision_ref: "J10",
	notes: "404 on the old host today; recommended opt-in to the new blog home (review finding MU-6).",
});
for (const p of ["/status/", "/portfolio/", "/resume/", "/post/", "/category/", "/tag/"]) {
	gone(p, "other", {
		decision_ref: ["/status/", "/portfolio/", "/resume/"].includes(p) ? "J10" : null,
		notes: p === "/tag/" ? "404 today. No tag or author URLs ever existed on the Astro site." : "404 today.",
	});
}
for (const p of ["/leaflet-map/", "/mapbox-map/", "/maplibre-map/", "/openlayers-map/", "/site-analytics/"]) {
	gone(p, "legacy-django", { notes: "2022 portfolio demo page; 404 today." });
}
// Django routes (git history) and account/admin paths
for (const p of [
	"/about/",
	"/answer-with-gpt/",
	"/captcha/",
	"/cesium-map/",
	"/ckeditor/",
	"/ckeditor5/",
	"/comments/new/",
	"/config/",
	"/count-characters/",
	"/delete/",
	"/geo-asteroids/",
	"/logout/",
	"/login/",
	"/register/",
	"/profile/",
	"/roadmap/",
	"/siteanalytics/",
	"/unittests/",
	"/update/",
	"/post/new/",
	"/password-reset-complete/",
]) {
	gone(p, "legacy-django", { decision_ref: "J10", notes: "Retired Django route; 404 today." });
}
const djangoPattern = (source, notes) =>
	row({ source, match: "pattern", class: "legacy-django", action: "stays-404", decision_ref: "J10", notes });
djangoPattern("/admin/:path*{/}?", "Django admin; 404 today.");
djangoPattern("/password-reset/:path*{/}?", "Django password reset (incl. /done/); 404 today.");
djangoPattern("/password-reset-confirm/:path*{/}?", "Django password reset confirm; 404 today.");
djangoPattern("/generate-with-gpt/:path*{/}?", "Django AI endpoint; 404 today.");
djangoPattern("/like/:path*{/}?", "Django likes; 404 today.");
djangoPattern("/comment/:path*{/}?", "Django comment CRUD; 404 today.");
djangoPattern("/user/:path*{/}?", "Django user profiles; 404 today.");
djangoPattern("/post/:pk(\\d+){/}?", "Pre-slug numeric post URLs (2020-08 to 2022-02); no evidence of inbound links.");
djangoPattern(
	"/post/:id/:action(comment|delete|update)/:rest*{/}?",
	"Django post comment/delete/update routes (int pk and slug forms).",
);
row({
	source: "/post/:slug/test{/}?",
	match: "pattern",
	class: "other",
	action: "stays-404",
	notes: "Wayback-captured junk (/post/<slug>/test); 404 today.",
});
row({
	source: "/static/:path*{/}?",
	match: "pattern",
	class: "legacy-static",
	action: "stays-404",
	decision_ref: "J10",
	notes: "Django collectstatic output; 404 today.",
});
for (const [source, notes] of [
	["/media/post_metaimgs/:file", "Django meta images; every file is still 200 on CloudFront (opt-in pattern redirect possible)."],
	["/media/django_ckeditor_5/:file", "CKEditor uploads; 37 have a same-size CloudFront twin (opt-in rows possible)."],
	["/media/uploads/:path*", "CKEditor 4 uploads; see above."],
	["/media/profile_pics/:file", "Django profile pictures."],
]) {
	row({ source, match: "pattern", class: "legacy-media", action: "stays-404", decision_ref: "J10", notes: `${notes} 404 today.` });
}
gone("/media/default.png", "legacy-media", { decision_ref: "J10", notes: "Django default image; 404 today." });
row({ source: "/cdn-cgi/:path*{/}?", match: "pattern", class: "other", action: "stays-404", notes: "Cloudflare-era artifacts; 404 today." });
for (const f of [
	"ai-plugin.json",
	"assetlinks.json",
	"dnt-policy.txt",
	"en",
	"gpc.json",
	"nodeinfo",
	"openid-configuration",
	"trust.txt",
]) {
	gone(`/.well-known/${f}`, "other", { notes: "Crawler probe; 404 today (Vercel serves /.well-known from the filesystem only)." });
}
// J10 candidates: crawler probes with a plausible jsolly.com destination, left 404 by default.
const J10_CANDIDATES = new Set(["/atom.xml", "/feed.xml", "/feed/", "/index.xml", "/sitemap-index.xml", "/sitemap-0.xml"]);
for (const p of [
	"/ads.txt",
	"/app-ads.txt",
	"/atom.xml",
	"/feed.xml",
	"/feed/",
	"/feeds/all.atom.xml",
	"/index.xml",
	"/sitemap-index.xml",
	"/sitemap-0.xml",
	"/apple-touch-icon.png",
	"/blogthedata.com",
	"/www.blogthedata.com",
	"/blogthedata.com/post/how-to-implement-content-security-policy-django/",
	"/doesnotexist/",
	"/zz-random-xyz/",
	"/wp-login.php",
	"/src/scripts/carousel.js",
	"/post/how-to-implement-subresource-integrity-django/local.js",
]) {
	gone(p, "other", {
		decision_ref: J10_CANDIDATES.has(p) ? "J10" : null,
		notes:
			p === "/wp-login.php"
				? "403 today (Vercel firewall); 404 or 403 after cutover, never a redirect."
				: "Probe or dead reference; 404 today.",
	});
}

// ---------------------------------------------------------------- matching
// Exact rows whose source ends in "/" cover both slash forms. Redirect rows additionally
// cover `<base>/index.html` and `<base>/index.html/`, mirroring the emitted
// `<base>{/index.html}?{/}?` source (review finding MU-1).
const isExactMatch = (r, p) => {
	if (p === r.source) return true;
	if (!r.source.endsWith("/") || r.source === "/") return false;
	if (p === r.source.slice(0, -1)) return true;
	return r.action === "redirect-301" && (p === `${r.source}index.html` || p === `${r.source}index.html/`);
};
const matchRows = (p) =>
	rows.filter((r) => (r.match === "exact" ? isExactMatch(r, p) : r._compiled.regex.test(p)));

const counts = {
	U: union.size,
	paths: 0,
	templates: 0,
	host_rules: 0,
	matched_exact: 0,
	matched_pattern: 0,
	matched_template: 0,
	unmatched: [],
	ambiguous: [],
};
const rowHits = new Map(rows.map((r) => [r, []]));
const sortedElements = [...union.values()].sort((a, b) =>
	a.kind === b.kind ? (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : a.kind < b.kind ? -1 : 1,
);
for (const el of sortedElements) {
	if (el.kind === "host-rule") {
		counts.host_rules++;
		continue;
	}
	const probe = el.kind === "template" ? instantiateTemplate(el.path) : el.path;
	const hits = matchRows(probe);
	if (el.kind === "template") counts.templates++;
	else counts.paths++;
	if (hits.length === 0) {
		counts.unmatched.push(el.path);
		continue;
	}
	if (hits.length > 1) {
		counts.ambiguous.push(`${el.path} -> ${hits.map((h) => h.source).join(" | ")}`);
		continue;
	}
	const [hit] = hits;
	rowHits.get(hit).push(el);
	if (el.kind === "template") counts.matched_template++;
	else if (hit.match === "exact") counts.matched_exact++;
	else counts.matched_pattern++;
}
// Structural assertion backing the host-rule elements: every row is host-agnostic.
const rowsWithHost = rows.filter((r) => "has" in r);
if (rowsWithHost.length) fail(`${rowsWithHost.length} rows carry a host condition`);

// Served-today ledger (review findings MU-2 / COMP-03): every path served 200 today (a file in
// the bf1f7ff1 dist, or a live 200 response) whose row makes it 404 after cutover. The set is
// pinned: anything outside it is a silent 200->404 drop and fails the generator.
const servedToday = (el) => el.kind === "path" && (el.evidence.has("served") || LIVE_200.has(el.path));
const LEDGER_ALLOWED = [/^\/_astro\/[^/]+$/u, /^\/release\.json$/u, /^\/search-index\.json$/u];
const ledger = [];
for (const [r, els] of rowHits) {
	if (r.action !== "stays-404") continue;
	for (const el of els) if (servedToday(el)) ledger.push({ path: el.path, row: r });
}
ledger.sort((a, b) => (a.path < b.path ? -1 : 1));
for (const l of ledger) {
	if (!LEDGER_ALLOWED.some((re) => re.test(l.path))) fail(`served-today path ${l.path} becomes 404 (row ${l.row.source}) and is not in the pinned ledger`);
}
const ledgerSummary = {
	total: ledger.length,
	astro_hashed: ledger.filter((l) => l.path.startsWith("/_astro/")).length,
	astro_in_freeze_dist: ledger.filter((l) => l.path.startsWith("/_astro/") && SERVED.includes(l.path)).length,
	astro_live_200: ledger.filter((l) => l.path.startsWith("/_astro/") && LIVE_200.has(l.path)).length,
	other: ledger.filter((l) => !l.path.startsWith("/_astro/")).map((l) => l.path),
};
// Every served-today path must map to a row that keeps it reachable or is in the ledger.
let servedTodayTotal = 0;
for (const el of union.values()) if (servedToday(el)) servedTodayTotal++;

// Evidence per row from the elements it matched; rows with no evidence are allowed
// only for the deliberate negative space (none expected).
for (const [r, els] of rowHits) {
	const ev = new Set();
	for (const el of els) for (const e of el.evidence) ev.add(e);
	r.evidence = [...ev].sort();
	if (r.match === "pattern") {
		r.samples = [...new Set(els.map((el) => (el.kind === "template" ? instantiateTemplate(el.path) : el.path)))].sort();
	}
	if (els.length === 0) fail(`row ${r.source} matches no union element (no evidence)`);
}

// ---------------------------------------------------------------- expected merged-site layout
const expected = new Set();
const addExpected = (p) => expected.add(p);
for (const f of DST_FILES) if (f.startsWith("public/")) addExpected(f.slice("public".length));
for (const f of DST_FILES) {
	const m = /^src\/pages\/(?<name>[^/]+)\.astro$/u.exec(f);
	if (m && !["404", "500"].includes(m.groups.name)) {
		addExpected(m.groups.name === "index" ? "/" : `/${m.groups.name}/`);
	}
}
addExpected("/sitemap-index.xml"); // @astrojs/sitemap in DST astro.config.ts
// Blog routes (brief item 4)
for (const p of ["/blog/", "/blog/all-posts/", "/blog/search/", "/blog/works-cited/", "/blog/rss.xml", "/blog/atom.xml", "/blog/search-index.json", "/blog/media/default.webp", "/blog/topographic-logo.svg"]) addExpected(p);
for (const f of SOCIAL) addExpected(`/blog/social/${f}`);
for (const s of POST_SLUGS) if (s !== RECIPE_POST) addExpected(`/blog/${s}/`);
for (const c of CATEGORY_SLUGS) addExpected(`/blog/category/${c}/`);
// Recipes (brief item 5)
for (const p of ["/recipes/", "/recipes/meals/", "/recipes/smoothies/", "/recipes/data/recipe-library.json", "/recipes/data/recipe-library.md", "/recipes/service-worker.js"]) addExpected(p);
for (const id of RECIPE_IDS) addExpected(`/recipes/${id}/`);
for (const f of RECIPE_MEDIA) addExpected(`/recipes/media/${f}`);
for (const f of RECIPE_PWA) addExpected(`/recipes/pwa/${f}`);
// Security files (brief item 16)
addExpected("/.well-known/security.txt");
addExpected("/pgp-key.txt");
if (!DST_FILES.has("public/favicon.ico")) fail("DST public/favicon.ico missing");
if (!DST_FILES.has("src/pages/privacy.astro")) fail("DST src/pages/privacy.astro missing");

const destinations = new Map(); // path -> [row sources]
const resolveDestination = (r, sample) => {
	if (r.match === "exact") return r.destination;
	const m = r._compiled.regex.exec(sample);
	let d = r.destination;
	r._compiled.names.forEach((name, idx) => {
		d = d.replace(`:${name}`, m[idx + 1] ?? "");
	});
	return d;
};
for (const r of rows) {
	if (r.action !== "redirect-301") continue;
	if (!r.destination.startsWith(`${JSOLLY}/`)) fail(`non-jsolly destination ${r.destination}`);
	const targets = r.match === "exact" ? [r.destination] : (r.samples ?? []).map((s) => resolveDestination(r, s));
	for (const t of targets) {
		const p = new URL(t).pathname;
		if (!expected.has(p)) fail(`destination ${p} (from ${r.source}) is outside the expected merged layout`);
		if (!destinations.has(p)) destinations.set(p, []);
		destinations.get(p).push(r.source);
	}
}
// No chains: no destination path is itself a source on the old host.
for (const r of rows) {
	if (r.action !== "redirect-301" || r.match !== "exact") continue;
	const destHost = new URL(r.destination).hostname;
	if (OLD_HOSTS.has(destHost)) fail(`chained redirect ${r.source} -> ${r.destination}`);
}
// Kill-switch and serve-200 paths must not be matched by any redirect row.
for (const r of rows.filter((x) => x.action !== "redirect-301")) {
	const probes = r.match === "exact" ? [r.source] : (r.samples ?? []);
	for (const p of probes) {
		const redirectHits = rows.filter((x) => x.action === "redirect-301" && x !== r && (x.match === "exact" ? isExactMatch(x, p) : x._compiled.regex.test(p)));
		if (redirectHits.length) fail(`${r.action} path ${p} is shadowed by redirect ${redirectHits[0].source}`);
	}
}

// ---------------------------------------------------------------- ids, ordering, outputs
const CLASS_ORDER = [
	"index",
	"post",
	"category",
	"archive",
	"search",
	"feed",
	"sitemap",
	"robots",
	"security",
	"recipe-page",
	"recipe-data",
	"recipe-pwa",
	"service-worker",
	"asset-chrome",
	"asset-media",
	"asset-hashed",
	"legacy-alias",
	"legacy-django",
	"legacy-media",
	"legacy-static",
	"other",
];
const ACTION_ORDER = ["redirect-301", "serve-200", "stays-404"];
const PREFIX = {
	index: "IDX",
	post: "PST",
	category: "CAT",
	archive: "ARC",
	search: "SRH",
	feed: "FED",
	sitemap: "SMP",
	robots: "RBT",
	security: "SEC",
	"recipe-page": "RCP",
	"recipe-data": "RDA",
	"recipe-pwa": "PWA",
	"service-worker": "SWK",
	"asset-chrome": "CHR",
	"asset-media": "MED",
	"asset-hashed": "HSH",
	"legacy-alias": "ALI",
	"legacy-django": "DJG",
	"legacy-media": "LMD",
	"legacy-static": "LST",
	other: "OTH",
};
for (const r of rows) if (!CLASS_ORDER.includes(r.class)) fail(`unknown class ${r.class}`);
rows.sort(
	(a, b) =>
		CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) ||
		ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) ||
		(a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
);
const seq = {};
for (const r of rows) {
	seq[r.class] = (seq[r.class] ?? 0) + 1;
	r.id = `${PREFIX[r.class]}-${String(seq[r.class]).padStart(3, "0")}`;
}
const sources = new Set();
for (const r of rows) {
	if (sources.has(r.source)) fail(`duplicate source ${r.source}`);
	sources.add(r.source);
}

const tally = (key) => {
	const t = {};
	for (const r of rows) t[r[key]] = (t[r[key]] ?? 0) + 1;
	return t;
};
const byClassAction = {};
for (const r of rows) {
	byClassAction[r.class] ??= { "redirect-301": 0, "serve-200": 0, "stays-404": 0 };
	byClassAction[r.class][r.action]++;
}
const redirectRows = rows.filter((r) => r.action === "redirect-301");
const meta = {
	source_repo: "jsolly/awesome-blog",
	source_ref: SRC_REF,
	source_sha: SOURCE_SHA,
	generated_by: "build-url-map.mjs (blogthedata merge plan bundle, out/); deterministic, node built-ins only",
	hosts: ["blogthedata.com", "www.blogthedata.com", "blogthedata.vercel.app"],
	host_policy: "Every row is host-agnostic (no `has`): one rule set answers every hostname attached to the redirect project.",
	slash_policy: "Exact redirect rows whose source ends in '/' cover the slashless, slash, /index.html and /index.html/ forms (emitted as `<source-without-slash>{/index.html}?{/}?`); file rows match exactly.",
	case_policy: "Sources and destinations preserve slug case; matching is case-sensitive (routing-utils sourceToRegex sensitive:true).",
	status: "redirect-301 rows emit statusCode 301; http:// adds Vercel's HTTPS 308 first hop.",
	counts: {
		rows: rows.length,
		by_action: tally("action"),
		by_match: tally("match"),
		by_class: tally("class"),
		by_class_action: byClassAction,
		vercel_redirect_entries: redirectRows.length,
		served_today_paths: servedTodayTotal,
		served_today_to_404_ledger: ledgerSummary,
		destination_paths: destinations.size,
		inputs: inputCounts,
		union: {
			U: counts.U,
			paths: counts.paths,
			templates: counts.templates,
			host_rules: counts.host_rules,
			matched_exact: counts.matched_exact,
			matched_pattern: counts.matched_pattern,
			matched_template: counts.matched_template,
			unmatched: counts.unmatched.length,
			ambiguous: counts.ambiguous.length,
		},
	},
};
const cleanRow = (r) => {
	const { _compiled, ...rest } = r;
	return rest;
};
mkdirSync(OUT, { recursive: true });
writeFileSync(
	path.join(OUT, "url-map.json"),
	`${JSON.stringify({ meta, rows: rows.map(cleanRow) }, null, "\t")}\n`,
);
writeFileSync(
	path.join(OUT, "url-map-destinations.json"),
	`${JSON.stringify(
		{
			source_sha: SOURCE_SHA,
			note: "Every jsolly.com path a redirect row (or pattern sample) resolves to. The Phase B destination-existence test asserts each exists in the built dist.",
			paths: [...destinations.keys()].sort(),
		},
		null,
		"\t",
	)}\n`,
);

// Union elements with their matching row (input for the compiler cross-check and the Phase A test).
writeFileSync(
	path.join(OUT, "url-map-union.json"),
	`${JSON.stringify(
		{
			source_sha: SOURCE_SHA,
			elements: sortedElements.map((el) => {
				const probe = el.kind === "template" ? instantiateTemplate(el.path) : el.kind === "path" ? el.path : null;
				const hit = probe === null ? null : rows.find((r) => rowHits.get(r).includes(el));
				return {
					kind: el.kind,
					path: el.path,
					probe,
					row_id: hit ? hit.id : null,
					queries: [...el.queries].sort().slice(0, 5),
					hosts: [...el.hosts].sort(),
					served_today: servedToday(el),
					evidence: [...el.evidence].sort(),
				};
			}),
		},
		null,
		"\t",
	)}\n`,
);

// Preview of the generated redirect-host vercel.json (implementation: legacy/blogthedata/vercel.json)
const toVercelSource = (r) =>
	r.match === "exact" && r.source.endsWith("/") && r.source !== "/"
		? `${r.source.slice(0, -1)}{/index.html}?{/}?`
		: r.source;
const vercelJson = {
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
		{
			source: "/(.*)",
			headers: [
				{ key: "X-Content-Type-Options", value: "nosniff" },
				{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
				{ key: "X-Frame-Options", value: "DENY" },
				{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
			],
		},
		...rows
			.filter((r) => r.class === "service-worker")
			.map((r) => ({
				source: r.source,
				headers: [
					{ key: "Content-Type", value: "application/javascript; charset=utf-8" },
					{ key: "Cache-Control", value: "no-cache" },
				],
			})),
	],
	redirects: redirectRows.map((r) => ({
		source: toVercelSource(r),
		destination: r.destination,
		statusCode: 301,
	})),
};
writeFileSync(path.join(OUT, "legacy-blogthedata-vercel.json"), `${JSON.stringify(vercelJson, null, "\t")}\n`);

// ---------------------------------------------------------------- url-map.md
const md = [];
md.push("# blogthedata.com URL map (appendix)");
md.push("");
md.push(`Generated by \`build-url-map.mjs\` from awesome-blog \`${SOURCE_SHA}\`. Machine-readable: \`url-map.json\` (becomes \`legacy/blogthedata/url-map.json\`). Every row is host-agnostic (blogthedata.com, www.blogthedata.com, blogthedata.vercel.app), passes the query string through, and preserves slug case. Redirect rows whose source ends in \`/\` also match the slashless, \`/index.html\` and \`/index.html/\` forms in the same single 301.`);
md.push("");
md.push(`Rows: ${rows.length} (${Object.entries(tally("action")).map(([k, v]) => `${k} ${v}`).join(", ")}). Pattern rows: ${tally("match").pattern ?? 0}. Distinct jsolly.com destination paths: ${destinations.size}.`);
md.push("");
md.push("## Summary by class");
md.push("");
md.push("| Class | Rows | redirect-301 | serve-200 | stays-404 |");
md.push("| --- | --- | --- | --- | --- |");
for (const c of CLASS_ORDER) {
	const t = byClassAction[c];
	if (!t) continue;
	md.push(`| ${c} | ${t["redirect-301"] + t["serve-200"] + t["stays-404"]} | ${t["redirect-301"]} | ${t["serve-200"]} | ${t["stays-404"]} |`);
}
md.push("");
md.push("## Union check");
md.push("");
md.push(`U = ${counts.U} distinct normalized paths from urls-build.json, served-files.txt (the bf1f7ff1 dist file list), urls-live.json (both hosts), urls-history.json, sitemap-locs.txt and SRC redirect config. Matched exact ${counts.matched_exact}, matched by pattern ${counts.matched_pattern}, Django templates matched by pattern ${counts.matched_template}, host-scope elements ${counts.host_rules} (satisfied structurally: 0 rows carry \`has\`). UNMATCHED ${counts.unmatched.length}. AMBIGUOUS ${counts.ambiguous.length}.`);
md.push("");
const esc = (s) => String(s).replace(/\|/gu, "\\|");
for (const c of CLASS_ORDER) {
	const cr = rows.filter((r) => r.class === c);
	if (!cr.length) continue;
	md.push(`## ${c} (${cr.length})`);
	md.push("");
	md.push("| id | source | match | action | destination | decision | evidence | notes |");
	md.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
	for (const r of cr) {
		const sampleNote = r.samples ? ` Matches ${r.samples.length} known path(s).` : "";
		md.push(`| ${r.id} | \`${esc(r.source)}\` | ${r.match} | ${r.action} | ${r.destination ? `\`${esc(r.destination)}\`` : "—"} | ${r.decision_ref ?? ""} | ${r.evidence.join(", ")} | ${esc(r.notes)}${sampleNote} |`);
	}
	md.push("");
}
writeFileSync(path.join(OUT, "url-map.md"), `${md.join("\n")}\n`);

// ---------------------------------------------------------------- check report
const lines = [];
lines.push(`URL MAP UNION CHECK — source ${SOURCE_SHA}`);
lines.push(`inputs: build ${inputCounts.build_rows} rows, served dist files ${inputCounts.served_files}, live ${inputCounts.live_rows} rows, history ${inputCounts.history_rows} rows, sitemap ${inputCounts.sitemap_locs} locs, SRC config ${inputCounts.config_entries} entries`);
lines.push(`normalization: scheme/host/port stripped, fragment dropped, query split off (kept as a field), percent-decoding per segment, case kept`);
lines.push(`|U| = ${counts.U}  (paths ${counts.paths}, Django route templates ${counts.templates}, host-scope elements ${counts.host_rules})`);
lines.push(`matched-by-exact    = ${counts.matched_exact}`);
lines.push(`matched-by-pattern  = ${counts.matched_pattern}`);
lines.push(`templates-by-pattern= ${counts.matched_template}  (instantiated with fixed sample values, matched by regex)`);
lines.push(`host-scope          = ${counts.host_rules}  (apex->www host rule; satisfied structurally: rows with a host condition = ${rowsWithHost.length})`);
lines.push(`UNMATCHED           = ${counts.unmatched.length}`);
for (const u of counts.unmatched) lines.push(`  UNMATCHED ${u}`);
lines.push(`AMBIGUOUS           = ${counts.ambiguous.length}`);
for (const a of counts.ambiguous) lines.push(`  AMBIGUOUS ${a}`);
lines.push(`sum check: ${counts.matched_exact} + ${counts.matched_pattern} + ${counts.matched_template} + ${counts.host_rules} + ${counts.unmatched.length} + ${counts.ambiguous.length} = ${counts.matched_exact + counts.matched_pattern + counts.matched_template + counts.host_rules + counts.unmatched.length + counts.ambiguous.length} (|U| ${counts.U})`);
lines.push("");
lines.push(`rows: ${rows.length}  ${JSON.stringify(tally("action"))}  ${JSON.stringify(tally("match"))}`);
lines.push(`vercel redirect entries: ${redirectRows.length} (limit 2,048)`);
lines.push(`served today (dist file or live 200): ${servedTodayTotal} paths; of those, deliberately 404 after cutover (pinned ledger): ${ledgerSummary.total}`);
lines.push(`  /_astro/* hashed assets: ${ledgerSummary.astro_hashed} (in the bf1f7ff1 dist: ${ledgerSummary.astro_in_freeze_dist}; live 200 in the crawl: ${ledgerSummary.astro_live_200}; ledger = union of both)`);
lines.push(`  other: ${ledgerSummary.other.join(", ")}`);
lines.push("  allowed set: /_astro/:file, /release.json, /search-index.json (anything else fails the generator)");
lines.push(`structural failures: ${failures.length}`);
for (const f of failures) lines.push(`  FAIL ${f}`);
lines.push("");
lines.push(`destination paths (${destinations.size}; every one is in the expected merged layout of ${expected.size} paths):`);
for (const p of [...destinations.keys()].sort()) lines.push(`  ${p}`);
const report = `${lines.join("\n")}\n`;
writeFileSync(path.join(OUT, "url-map-check.txt"), report);
process.stdout.write(report.split("\ndestination paths")[0]);
process.stdout.write(`\n(destination list: ${destinations.size} paths, see url-map-check.txt)\n`);
if (counts.unmatched.length || counts.ambiguous.length || failures.length) process.exit(1);
