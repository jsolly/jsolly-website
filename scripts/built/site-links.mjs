// The site model and link checkers behind scripts/built/internal-links.test.mjs
// (plan §4.3). readSite reads a built dist/ once: every file path (exact
// case, from distFiles) and the text of every file the checks read, with each
// HTML page parsed once. buildSite does the same for an in-memory fixture.
//   (a) brokenReferences: same-origin references that do not resolve, or
//       whose #fragment names no id on the target page;
//   (b) legacyHostLinks: links and URL-bearing values on the old blog host;
//   (c) miscasedLinks: mixed-case routes named in another case;
//   (d) legacyRoots: root-anchored legacy paths.
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { parse } from "parse5";
import {
	JSOLLY_ORIGIN,
	readLegacyJson,
} from "../../build/blogthedata-redirects.mjs";
import { MARKDOWN_PATHS } from "../../src/content/agent-pages.js";
import { markdownSiblingPath } from "../../src/lib/accept-negotiate.js";
import { DIST, distFileFor, distFiles } from "./pages.mjs";

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
export const SEARCH_INDEX = "blog/search-index.json";
export const POST_TEXT_FIELD = "text";
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
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const HTML_WHITESPACE = /[\t\n\f\r ]+/u;

// A URL on one of the old blog's hosts, with a scheme or protocol-relative.
function legacyUrlPattern(hosts) {
	const names = hosts
		.toSorted((a, b) => b.length - a.length)
		.map((text) => RegExp.escape(text))
		.join("|");
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- Every interpolated host or route is escaped with RegExp.escape before construction.
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

// HTML facts use the parsed document tree, excluding inert template contents.
// Keep XML below on an XML parser; HTML recovery rules do not apply to feeds.
const attributeName = (attribute) =>
	attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;

function readPage(file, markup) {
	const url = pageUrl(file);
	const nodes = [];
	function visit(n) {
		if (n.tagName) nodes.push(n);
		for (const c of n.childNodes ?? []) visit(c);
	}
	visit(parse(markup, { scriptingEnabled: false }));
	const attr = (n, k) =>
		n.attrs.find((a) => attributeName(a) === k)?.value ?? null;
	const firstBase = nodes.find(
		(n) =>
			n.namespaceURI === HTML_NAMESPACE &&
			n.tagName === "base" &&
			attr(n, "href") !== null,
	);
	let base = url.href;
	if (firstBase) {
		try {
			const u = new URL(attr(firstBase, "href"), url);
			if (!["data:", "javascript:"].includes(u.protocol)) base = u.href;
		} catch {
			// Invalid base URLs leave the document URL as its fallback base.
		}
	}
	const ids = new Set(),
		references = [],
		values = [],
		manifests = [];
	function text(n) {
		return n.nodeName === "#text"
			? n.value
			: (n.childNodes ?? []).map(text).join("");
	}
	for (const n of nodes) {
		const own = [];
		const id = attr(n, "id");
		if (id) ids.add(id);
		const anchor = attr(n, "name");
		if (n.namespaceURI === HTML_NAMESPACE && n.tagName === "a" && anchor)
			ids.add(anchor);
		for (const k of URL_ATTRIBUTES) {
			const raw = attr(n, k);
			if (raw !== null) own.push({ attribute: k, raw });
		}
		const srcset = attr(n, "srcset");
		if (srcset !== null)
			for (const raw of srcsetUrls(srcset))
				own.push({ attribute: "srcset", raw });
		if (n.tagName === "object" && attr(n, "data") !== null)
			own.push({ attribute: "data", raw: attr(n, "data") });
		const content = n.tagName === "meta" && attr(n, "content");
		if (content && ABSOLUTE_HTTP.test(content))
			own.push({ attribute: "content", raw: content });
		references.push(...own.map((r) => ({ ...r, base })));
		const referenced = new Set(own.map((r) => r.attribute));
		for (const a of n.attrs) {
			const k = attributeName(a);
			if (!referenced.has(k) && !PROSE_ATTRIBUTES.has(k))
				values.push(`${n.tagName}[${k}]: ${a.value}`);
		}
		if (n.tagName === "script" && text(n)) values.push(`script: ${text(n)}`);
		const rel = attr(n, "rel");
		if (
			n.tagName === "link" &&
			rel !== null &&
			(n.namespaceURI === HTML_NAMESPACE ? rel.toLowerCase() : rel)
				.split(HTML_WHITESPACE)
				.includes("manifest")
		)
			manifests.push(new URL(attr(n, "href"), base).href);
	}
	return { file, url, ids, references, values, manifests };
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
export async function buildSite(entries) {
	const markdown = await createSatteriMarkdownProcessor({
		syntaxHighlight: false,
		features: { gfm: false, smartPunctuation: false },
	});
	const files = new Set(entries.map(({ file }) => file));
	const pages = new Map();
	const values = new Map();
	const texts = new Map();
	for (const { file, text } of entries) {
		if (text === null) continue;
		texts.set(file, text);
		const extension = extname(file);
		if (extension === ".html" || extension === ".md") {
			// Render and parse one page at a time. Parallel Markdown renders retain
			// every syntax tree, rather than retaining every syntax tree until the suite ends.
			const markup =
				// biome-ignore lint/performance/noAwaitInLoops: Sequential rendering bounds syntax-tree memory on the CI runner.
				extension === ".md" ? (await markdown.render(text)).code : text;
			const page = readPage(file, markup);
			pages.set(file, page);
			values.set(file, page.values);
			await yieldToEventLoop();
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

export async function readSite(root = DIST) {
	const files = await distFiles(root);
	return buildSite(
		await Promise.all(
			[...files].map(async (file) => ({
				file,
				text: TEXT_EXTENSIONS.has(extname(file))
					? await readFile(join(root, file), "utf8")
					: null,
			})),
		),
	);
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
	if (!fragment || fragment.startsWith(":~:") || !site.pages.has(file)) {
		return null;
	}
	let id;
	try {
		id = decodeURIComponent(fragment);
	} catch {
		return "has a malformed percent escape in the fragment";
	}
	return site.pages.get(file).ids.has(id)
		? null
		: `has no id "${id}" on ${file}`;
}

// (a): every same-origin reference that does not resolve, as
// "<file> <attribute>=<raw>: <why>".
export function brokenReferences(site) {
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
export function legacyHostLinks(site) {
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
export function mixedCaseRoutes(posts, categories) {
	return new Map(
		[
			...posts.map((slug) => `/blog/${slug}`),
			...categories.map((slug) => `/blog/category/${slug}`),
		].map((path) => [path.toLowerCase(), path]),
	);
}

// (c): every place a file names a mixed-case route in another case.
export function miscasedLinks(site, routes) {
	const alternatives = [...routes.keys()]
		.toSorted((a, b) => b.length - a.length)
		.map((text) => RegExp.escape(text))
		.join("|");
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- Every interpolated host or route is escaped with RegExp.escape before construction.
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
export function legacyRoots(where, values) {
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
export async function sourceValues() {
	const files = await globby("src/**/*.{astro,css,js,json,mjs,svelte,ts}", {
		ignore: ["**/*.test.*"],
	});
	return Promise.all(
		files
			.toSorted((a, b) => a.localeCompare(b, "en"))
			.map(async (file) => [file, [await readFile(file, "utf8")]]),
	);
}
