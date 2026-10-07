import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import it from "node:test";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { MARKDOWN_PATHS } from "../../src/content/agent-pages.js";
import { markdownSiblingPath } from "../../src/lib/accept-negotiate.js";
import { JSOLLY_ORIGIN, readLegacyJson } from "../blogthedata-redirects.mjs";
import { categorySlugs, distFileFor, publishedPosts } from "./pages.mjs";

// Plan §4.3: the link checks over the whole build. dist/ is read and parsed
// once into a site model (`readSite`) that all four tests share; each test
// first runs its checker on a small in-memory site, so a checker that stops
// finding problems fails too.
//   (a) every same-origin reference in the HTML resolves, and every #fragment
//       names an id on its target page;
//   (b) nothing links to the old blog host (url-map.json meta.hosts); bare
//       text is fine, and the feeds' legacy ids are ids, not links;
//   (c) every link to a mixed-case post or category slug uses its exact case;
//   (d) no legacy root path (/post/, /search/, /media/, ...) is built in code
//       or in the JS, JSON and XML the HTML check cannot see.
const DIST = "dist";
const MIXED_CASE_POSTS = 22;
const MIXED_CASE_CATEGORIES = ["Geodev"];
// Text the checks read; everything else in dist/ only has to exist.
const TEXT_EXTENSIONS = new Set([
	".css",
	".html",
	".js",
	".json",
	".md",
	".svg",
	".txt",
	".webmanifest",
	".xml",
]);
const JSON_EXTENSIONS = new Set([".json", ".webmanifest"]);
// Attributes whose value is one URL, on any element.
const URL_ATTRIBUTES = [
	"action",
	"cite",
	"formaction",
	"href",
	"poster",
	"src",
	"xlink:href",
];
// The pages the middleware answers with Markdown: the five portfolio pages'
// .md siblings (PA3), which have no file in dist/.
const MIDDLEWARE_PATHS = new Set(MARKDOWN_PATHS.map(markdownSiblingPath));
// The search index's `text` is each post's body as plain text: the same prose
// and escaped code samples the post page renders as text, never a URL the
// site builds.
const SEARCH_INDEX = "blog/search-index.json";
const POST_TEXT_FIELD = "text";
// Plan §4.3 (d), root-anchored: the path starts a URL value, after a quote,
// "(", "=", whitespace, a backtick or an origin. `search-index` is listed
// before `search` so the old /search-index.json matches too (the plan's
// pattern only matched /search/ and /search.json).
const LEGACY_ROOT =
	/(?<=^|["'`(=\s]|blogthedata\.com|jsolly\.com)\/(?:post|category|all-posts|search-index|search|rss|atom|media|data|recipes-pwa|social)(?:\/|\.json)/gu;
// The feeds keep their legacy ids (plan §4.7, J8): the RSS guid of each
// pre-merge post, the Atom entry ids and the unchanged Atom feed id. Readers
// dedupe on them; they are ids, not links. Only these elements, with these
// exact forms, are allowlisted.
const LEGACY_POST_ID = /^https:\/\/www\.blogthedata\.com\/post\/[^/]+\/$/u;
const LEGACY_FEED_ID = "https://www.blogthedata.com/atom/";
const INDEX_HTML = /(?:^|\/)index\.html$/u;
const WHITESPACE = /\s+/u;
const ABSOLUTE_HTTP = /^https?:\/\//u;
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const MANIFEST_LINKS = "link[rel~=manifest]";

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// A URL on one of the old blog's hosts, with a scheme or protocol-relative.
function legacyUrlPattern(hosts) {
	const names = hosts
		.toSorted((a, b) => b.length - a.length)
		.map(escapeRegExp)
		.join("|");
	return new RegExp(
		`(?:[a-z][a-z\\d+.-]*:)?//(?:[\\w-]+\\.)*(?:${names})(?![\\w.-])`,
		"iu",
	);
}

const LEGACY_HOSTS = readLegacyJson("url-map.json").meta.hosts;
const LEGACY_URL = legacyUrlPattern(LEGACY_HOSTS);
// Attributes that hold prose for people, never a URL the page loads or links:
// alt text may quote a URL shown in a screenshot.
const PROSE_ATTRIBUTES = new Set([
	"alt",
	"aria-description",
	"aria-label",
	"placeholder",
	"title",
]);

// The URL a built file is served at: x/index.html is /x/.
function pageUrl(file) {
	const path = file === "index.html" ? "" : file.replace(INDEX_HTML, "/");
	return new URL(`/${path}`, JSOLLY_ORIGIN);
}

// The URLs in a srcset: each candidate is a URL and an optional descriptor.
function srcsetUrls(value) {
	return value
		.split(",")
		.map((candidate) => candidate.trim().split(WHITESPACE)[0])
		.filter(Boolean);
}

// Every URL reference an element carries, as { attribute, raw }.
function elementReferences(element) {
	const references = [];
	for (const name of URL_ATTRIBUTES) {
		const raw = element.getAttribute(name);
		if (raw !== null) references.push({ attribute: name, raw });
	}
	const srcset = element.getAttribute("srcset");
	if (srcset !== null) {
		for (const raw of srcsetUrls(srcset)) {
			references.push({ attribute: "srcset", raw });
		}
	}
	if (element.localName === "object" && element.hasAttribute("data")) {
		references.push({ attribute: "data", raw: element.getAttribute("data") });
	}
	// og:image, og:url, twitter:image and the like.
	const content =
		element.localName === "meta" && element.getAttribute("content");
	if (content && ABSOLUTE_HTTP.test(content)) {
		references.push({ attribute: "content", raw: content });
	}
	return references;
}

// One HTML page: its ids (and a[name] anchors, which fragments also reach),
// its references, and the other attribute values and script bodies (JSON-LD,
// island props) that could carry a URL.
function readPage(file, markup) {
	const url = pageUrl(file);
	const dom = new JSDOM(markup, { url: url.href });
	try {
		const { document } = dom.window;
		const ids = new Set();
		const references = [];
		const values = [];
		for (const element of document.querySelectorAll("*")) {
			if (element.id) ids.add(element.id);
			if (element.localName === "a" && element.name) ids.add(element.name);
			const own = elementReferences(element);
			for (const reference of own) {
				references.push({ ...reference, base: document.baseURI });
			}
			const referenced = new Set(own.map(({ attribute }) => attribute));
			for (const attribute of element.attributes) {
				if (
					referenced.has(attribute.name) ||
					PROSE_ATTRIBUTES.has(attribute.name)
				) {
					continue;
				}
				values.push(
					`${element.localName}[${attribute.name}]: ${attribute.value}`,
				);
			}
			if (element.localName === "script" && element.textContent) {
				values.push(`script: ${element.textContent}`);
			}
		}
		const manifests = [...document.querySelectorAll(MANIFEST_LINKS)].map(
			(link) => new URL(link.getAttribute("href"), document.baseURI).href,
		);
		return { file, url, ids, references, values, manifests };
	} finally {
		dom.window.close();
	}
}

// A web app manifest's own references, resolved against its URL.
function manifestReferences(manifest, href) {
	const raws = [
		...["id", "start_url", "scope"].map((key) => manifest[key]),
		...(manifest.icons ?? []).map((icon) => icon.src),
	].filter((raw) => typeof raw === "string");
	return raws.map((raw) => ({ attribute: "manifest", raw, base: href }));
}

// Every string in a parsed JSON value, as { key, value }.
function jsonStrings(value, key = null) {
	if (typeof value === "string") return [{ key, value }];
	if (Array.isArray(value))
		return value.flatMap((item) => jsonStrings(item, key));
	if (value && typeof value === "object") {
		return Object.entries(value).flatMap(([name, item]) =>
			jsonStrings(item, name),
		);
	}
	return [];
}

// The text a JSON file can build a URL from: every string except the search
// index's post bodies.
function jsonValues(file, text) {
	return jsonStrings(JSON.parse(text))
		.filter(({ key }) => !(file === SEARCH_INDEX && key === POST_TEXT_FIELD))
		.map(({ key, value }) => `${key ?? "(value)"}: ${value}`);
}

// Whether an XML text node is one of the feeds' allowlisted legacy ids.
function isLegacyId(node) {
	const element = node.parentElement;
	const parent = element?.parentElement;
	const value = node.nodeValue;
	if (element?.localName === "guid" && parent?.localName === "item") {
		return (
			element.getAttribute("isPermaLink") === "false" &&
			LEGACY_POST_ID.test(value)
		);
	}
	if (element?.localName !== "id") return false;
	if (parent?.localName === "entry") return LEGACY_POST_ID.test(value);
	return (
		parent?.localName === "feed" &&
		!parent.parentElement &&
		value === LEGACY_FEED_ID
	);
}

// The attribute values and text of an XML file (a feed or sitemap), less the
// allowlisted legacy ids.
function xmlValues(text) {
	const dom = new JSDOM(text, { contentType: "application/xml" });
	try {
		const { document } = dom.window;
		const values = [];
		for (const element of document.querySelectorAll("*")) {
			for (const attribute of element.attributes) {
				values.push(
					`${element.localName}[${attribute.name}]: ${attribute.value}`,
				);
			}
			for (const node of element.childNodes) {
				const isText =
					node.nodeType === node.TEXT_NODE ||
					node.nodeType === node.CDATA_SECTION_NODE;
				if (isText && node.nodeValue.trim() && !isLegacyId(node)) {
					values.push(`${element.localName}: ${node.nodeValue}`);
				}
			}
		}
		return values;
	} finally {
		dom.window.close();
	}
}

// The site model over `entries` ({ file, text }; text is null for a file the
// checks do not read): the exact-case file set, the parsed HTML pages by
// file, every manifest's references, and per file the values (b) and (d)
// scan. HTML text nodes are not values: prose and code samples may name any
// URL as text.
function buildSite(entries) {
	const files = new Set(entries.map(({ file }) => file));
	const pages = new Map();
	const values = new Map();
	const texts = new Map();
	for (const { file, text } of entries) {
		if (text === null) continue;
		texts.set(file, text);
		const extension = extname(file);
		if (extension === ".html") {
			const page = readPage(file, text);
			pages.set(file, page);
			values.set(file, page.values);
		} else if (JSON_EXTENSIONS.has(extension)) {
			values.set(file, jsonValues(file, text));
		} else if (extension === ".xml") {
			values.set(file, xmlValues(text));
		} else {
			values.set(file, [text]);
		}
	}
	const manifests = new Map();
	for (const page of pages.values()) {
		for (const href of page.manifests) {
			const file = distFileFor(new URL(href).pathname);
			if (manifests.has(href) || !texts.has(file)) continue;
			manifests.set(
				href,
				manifestReferences(JSON.parse(texts.get(file)), href),
			);
		}
	}
	return { files, pages, values, texts, manifests };
}

async function readSite(root) {
	const files = await globby("**/*", { cwd: root, dot: true });
	return buildSite(
		await Promise.all(
			files.map(async (file) => ({
				file,
				text: TEXT_EXTENSIONS.has(extname(file))
					? await readFile(join(root, file), "utf8")
					: null,
			})),
		),
	);
}

let distSite;
// dist/ as a site model, read once for all four tests.
function dist() {
	distSite ??= readSite(DIST).then((site) => {
		if (!site.files.has("index.html")) {
			throw new Error("dist/ is required: run `npm run build` first");
		}
		return site;
	});
	return distSite;
}

// Why a same-origin `url` does not resolve in `site`, or null when it does.
function unresolved(site, url) {
	let file;
	try {
		file = distFileFor(url.pathname);
	} catch {
		return "has a malformed percent escape";
	}
	if (!site.files.has(file)) {
		if (MIDDLEWARE_PATHS.has(url.pathname)) return null;
		// vercel.json trailingSlash: the slashless form answers 308, not the page.
		return site.files.has(`${file}/index.html`)
			? "links a page without its trailing slash"
			: "has no file in dist/";
	}
	const fragment = url.hash.slice(1);
	// A fragment only names an element on an HTML page; #:~:text= is a text
	// directive, not an id.
	if (!fragment || fragment.startsWith(":~:") || extname(file) !== ".html") {
		return null;
	}
	const id = decodeURIComponent(fragment);
	return site.pages.get(file).ids.has(id)
		? null
		: `has no id "${id}" on ${file}`;
}

// (a): every same-origin reference that does not resolve, as
// "<file> <attribute>=<raw>: <why>".
function brokenReferences(site) {
	const references = [
		...[...site.pages.values()].flatMap((page) =>
			page.references.map((reference) => ({ ...reference, file: page.file })),
		),
		...[...site.manifests].flatMap(([href, list]) =>
			list.map((reference) => ({
				...reference,
				file: distFileFor(new URL(href).pathname),
			})),
		),
	];
	return references.flatMap(({ file, attribute, raw, base }) => {
		let url;
		try {
			url = new URL(raw, base);
		} catch {
			return [`${file} ${attribute}=${raw}: is not a URL`];
		}
		if (url.origin !== JSOLLY_ORIGIN) return [];
		const problem = unresolved(site, url);
		return problem ? [`${file} ${attribute}=${raw}: ${problem}`] : [];
	});
}

function isLegacyHost(raw, base) {
	let hostname;
	try {
		({ hostname } = new URL(raw, base));
	} catch {
		return false;
	}
	return LEGACY_HOSTS.some(
		(host) => hostname === host || hostname.endsWith(`.${host}`),
	);
}

// (b): every reference whose host is the old blog's ("<file> <attribute>=<url>";
// a URL in another site's query, such as a speed test of the old host, links
// that site), then every other value that carries a URL on the old host
// ("<file> <where>: <value>").
function legacyHostLinks(site) {
	const links = [...site.pages.values()].flatMap((page) =>
		page.references
			.filter(({ raw, base }) => isLegacyHost(raw, base))
			.map(({ attribute, raw }) => `${page.file} ${attribute}=${raw}`),
	);
	const values = [...site.values].flatMap(([file, list]) =>
		list
			.filter((value) => LEGACY_URL.test(value))
			.map((value) => `${file} ${value.slice(0, 160)}`),
	);
	return [...links, ...values];
}

// The exact paths of the mixed-case routes for these slugs, by lowercase.
function mixedCaseRoutes(posts, categories) {
	return new Map(
		[
			...posts.map((slug) => `/blog/${slug}`),
			...categories.map((slug) => `/blog/category/${slug}`),
		].map((path) => [path.toLowerCase(), path]),
	);
}

// (c): every place a file names a mixed-case route in another case.
function miscasedLinks(site, routes) {
	const alternatives = [...routes.keys()]
		.toSorted((a, b) => b.length - a.length)
		.map(escapeRegExp)
		.join("|");
	const pattern = new RegExp(`(?:${alternatives})(?![\\w-])`, "giu");
	return [...site.texts].flatMap(([file, text]) =>
		[...text.matchAll(pattern)]
			.filter(([match]) => routes.get(match.toLowerCase()) !== match)
			.map(
				([match]) =>
					`${file}: ${match} (route ${routes.get(match.toLowerCase())})`,
			),
	);
}

// (d): every legacy root path in `values`, as "<where>: <context>".
function legacyRoots(where, values) {
	return values.flatMap((value) =>
		[...value.matchAll(LEGACY_ROOT)].map(
			(match) =>
				`${where}: ${value.slice(Math.max(0, match.index - 40), match.index + 40).trim()}`,
		),
	);
}

// The source files (d) holds to the same rule: the code and data under src/,
// not the posts' Markdown ((a) to (c) check what it renders) and not tests,
// whose fixtures model the old site's map on purpose.
async function sourceValues() {
	const files = await globby("src/**/*.{astro,css,js,json,mjs,svelte,ts}", {
		ignore: ["**/*.test.*"],
	});
	return Promise.all(
		files
			.toSorted((a, b) => a.localeCompare(b, "en"))
			.map(async (file) => [file, [await readFile(file, "utf8")]]),
	);
}

// An in-memory site for the checkers' own fixtures.
function fixtureSite(files) {
	return buildSite(
		Object.entries(files).map(([file, text]) => ({ file, text })),
	);
}

const html = (body, head = "") =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

it("(a) every same-origin link, image, script, manifest and icon in the build resolves, and every #fragment names an id on its page", async (t) => {
	const fixture = fixtureSite({
		"index.html": html(
			[
				'<a href="/blog/post/#kept">ok</a>',
				'<a href="/blog/post/#lost">lost id</a>',
				'<a href="/blog/post">no slash</a>',
				'<a href="/blog/gone/">gone</a>',
				'<a href="https://www.jsolly.com/blog/Post/">wrong case</a>',
				'<a href="https://example.com/x/">external</a>',
				'<a href="mailto:a@example.com">mail</a>',
				'<a href="#top-id">self</a>',
				'<a href="/index.md">markdown</a>',
				'<img src="/a.webp" srcset="/a.webp 1x, /b.webp 2x">',
				'<p id="top-id"></p>',
			].join(""),
			'<link rel="manifest" href="/site.webmanifest">',
		),
		"blog/post/index.html": html('<h2 id="kept">Kept</h2><a name="named"></a>'),
		"site.webmanifest": JSON.stringify({
			start_url: "/",
			icons: [{ src: "/icon.png" }, { src: "/missing.png" }],
		}),
		"a.webp": null,
		"icon.png": null,
	});
	assert.deepEqual(
		brokenReferences(fixture),
		[
			'index.html href=/blog/post/#lost: has no id "lost" on blog/post/index.html',
			"index.html href=/blog/post: links a page without its trailing slash",
			"index.html href=/blog/gone/: has no file in dist/",
			"index.html href=https://www.jsolly.com/blog/Post/: has no file in dist/",
			"index.html srcset=/b.webp: has no file in dist/",
			"site.webmanifest manifest=/missing.png: has no file in dist/",
		],
		"the checker finds each broken reference in a fixture site",
	);
	const site = await dist();
	const count =
		[...site.pages.values()].reduce(
			(sum, page) => sum + page.references.length,
			0,
		) +
		[...site.manifests.values()].reduce((sum, list) => sum + list.length, 0);
	t.diagnostic(
		`${count} references on ${site.pages.size} pages and ${site.manifests.size} manifests`,
	);
	assert.deepEqual(brokenReferences(site), [], "broken same-origin references");
});

it("(b) the build links nothing on the old blog host; prose may name it and the feeds keep their legacy ids", async () => {
	const fixture = fixtureSite({
		"index.html": html(
			[
				'<a href="https://www.blogthedata.com/post/x/">link</a>',
				'<img src="//blogthedata.vercel.app/a.png">',
				'<a href="https://github.com/jsolly/blogthedata/pull/39">repo</a>',
				'<a href="https://speedvitals.com/ttfb-test?url=https://blogthedata.com">speed test</a>',
				'<div data-href="https://blogthedata.com/x/"></div>',
				'<a href="/blog/How-Ive-made-blogthedata-more-accessible/">slug</a>',
				"<p>Prose: blogthedata.com and https://blogthedata.com/admin as text.</p>",
				'<img src="/shot.png" alt="Google showing https://blogthedata.com/sitemap.xml">',
				// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
				'<script type="application/ld+json">{"sameAs":["https://blogthedata.com"]}</script>',
			].join(""),
		),
		"blog/rss.xml": [
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<?xml version="1.0"?><rss><channel><link>https://www.jsolly.com/blog/rss.xml</link>',
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<item><link>https://www.jsolly.com/blog/x/</link><guid isPermaLink="false">https://www.blogthedata.com/post/x/</guid></item>',
			"<item><link>https://www.blogthedata.com/post/y/</link><guid>https://www.blogthedata.com/post/y/</guid></item>",
			"</channel></rss>",
		].join(""),
		"blog/atom.xml": [
			'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://www.blogthedata.com/atom/</id>',
			'<link href="https://www.blogthedata.com/atom/" rel="self"/>',
			"<entry><id>https://www.blogthedata.com/post/x/</id></entry></feed>",
		].join(""),
		[SEARCH_INDEX]: JSON.stringify([
			{ slug: "x", [POST_TEXT_FIELD]: "visit https://blogthedata.com/admin" },
			{ slug: "y", title: "https://www.blogthedata.com/post/y/" },
		]),
		"app.js": 'fetch("https://blogthedata.com/search-index.json")',
	});
	assert.deepEqual(
		legacyHostLinks(fixture),
		[
			"index.html href=https://www.blogthedata.com/post/x/",
			"index.html src=//blogthedata.vercel.app/a.png",
			"index.html div[data-href]: https://blogthedata.com/x/",
			'index.html script: {"sameAs":["https://blogthedata.com"]}',
			"blog/rss.xml link: https://www.blogthedata.com/post/y/",
			"blog/rss.xml guid: https://www.blogthedata.com/post/y/",
			"blog/atom.xml link[href]: https://www.blogthedata.com/atom/",
			"blog/search-index.json title: https://www.blogthedata.com/post/y/",
			'app.js fetch("https://blogthedata.com/search-index.json")',
		],
		"the checker finds each link to the old host in a fixture site",
	);
	assert.deepEqual(
		legacyHostLinks(await dist()),
		[],
		"links to the old blog host",
	);
});

it("(c) every link to a mixed-case post or category uses the slug's exact case", async (t) => {
	const fixture = fixtureSite({
		"index.html": html(
			[
				'<a href="/blog/Mixed-Post/">exact</a>',
				'<a href="/blog/mixed-post/">lower</a>',
				'<a href="https://www.jsolly.com/blog/category/geodev/">lower category</a>',
				'<a href="/blog/mixed-post-two/">another slug</a>',
			].join(""),
		),
		"sitemap-0.xml": "<loc>https://www.jsolly.com/blog/MIXED-POST/</loc>",
	});
	assert.deepEqual(
		miscasedLinks(fixture, mixedCaseRoutes(["Mixed-Post"], ["Geodev"])),
		[
			"index.html: /blog/mixed-post (route /blog/Mixed-Post)",
			"index.html: /blog/category/geodev (route /blog/category/Geodev)",
			"sitemap-0.xml: /blog/MIXED-POST (route /blog/Mixed-Post)",
		],
		"the checker finds each miscased link in a fixture site",
	);
	const posts = (await publishedPosts())
		.map((post) => post.slug)
		.filter((slug) => slug !== slug.toLowerCase());
	const categories = (await categorySlugs()).filter(
		(slug) => slug !== slug.toLowerCase(),
	);
	t.diagnostic(
		`${posts.length} mixed-case posts and ${categories.length} mixed-case categories (${categories.join(", ")})`,
	);
	assert.equal(
		posts.length,
		MIXED_CASE_POSTS,
		"plan §4.3 (c): 22 mixed-case posts",
	);
	assert.deepEqual(categories, MIXED_CASE_CATEGORIES, "plan §4.3 (c): Geodev");
	const routes = mixedCaseRoutes(posts, categories);
	assert.equal(
		routes.size,
		posts.length + categories.length,
		"no two routes differ only in case",
	);
	assert.deepEqual(
		miscasedLinks(await dist(), routes),
		[],
		"links in the wrong case",
	);
});

it("(d) no legacy root path is built in src/ code or in the build's JS, JSON, XML and manifests", async () => {
	const flagged = [
		'"/post/x/"',
		"'/category/Geodev/'",
		"(/media/a.png)",
		"href=/rss/",
		"see /atom/ here",
		"`/search-index.json`",
		"`/search/?searched=x`",
		'"/data/x.json"',
		'"/recipes-pwa/icon.png"',
		'"/social/x.svg"',
		'"/all-posts/"',
		"https://www.blogthedata.com/post/x/",
		"https://blogthedata.com/atom/",
		"https://www.jsolly.com/search.json",
	];
	const passed = [
		'"/blog/post-x/"',
		'"/blog/media/x.webp"',
		'"/blog/category/Geodev/"',
		'"/blog/search/"',
		'"/blog/search-index.json"',
		'"/recipes/data/recipe-library.json"',
		'"/recipes/pwa/icon-192.png"',
		'"/blog/social/xLogo.svg"',
		"https://example.com/post/x/",
		"https://d1d7p8ufhgz4ld.cloudfront.net/media/post_metaimgs/a.png",
		'"/posts/"',
		'"/media"',
	];
	assert.deepEqual(
		flagged.filter((value) => legacyRoots("fixture", [value]).length !== 1),
		[],
		"each legacy root form is caught once",
	);
	assert.deepEqual(
		passed.flatMap((value) => legacyRoots("fixture", [value])),
		[],
		"new paths and external URLs are not legacy roots",
	);
	const fixture = fixtureSite({
		"blog/rss.xml": [
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<?xml version="1.0"?><rss><channel>',
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<item><guid isPermaLink="false">https://www.blogthedata.com/post/x/</guid></item>',
			"<item><link>https://www.jsolly.com/post/y/</link></item></channel></rss>",
		].join(""),
		[SEARCH_INDEX]: JSON.stringify([
			{ slug: "x", [POST_TEXT_FIELD]: "the code read /media/uploads" },
			{ slug: "/post/y/", title: "y" },
		]),
	});
	assert.deepEqual(
		[...fixture.values].flatMap(([file, values]) => legacyRoots(file, values)),
		[
			"blog/rss.xml: link: https://www.jsolly.com/post/y/",
			"blog/search-index.json: slug: /post/y/",
		],
		"the allowlist covers only the feed ids and the search index's post text",
	);
	const site = await dist();
	const built = [...site.values]
		.filter(([file]) =>
			[".js", ".json", ".xml", ".webmanifest"].includes(extname(file)),
		)
		.flatMap(([file, values]) => legacyRoots(file, values));
	const source = (await sourceValues()).flatMap(([file, values]) =>
		legacyRoots(file, values),
	);
	assert.deepEqual([...source, ...built], [], "legacy root paths");
});
