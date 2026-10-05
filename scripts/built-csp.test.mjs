import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import it from "node:test";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { parseDirectives, readHeaderPolicy } from "./csp.mjs";

const WHITESPACE = /\s+/u;
const SCHEME_SOURCE = /^[a-z][a-z\d+.-]*:$/iu;
// The origin 'self' resolves to in production, and the base for relative URLs.
const SITE_ORIGIN = "https://www.jsolly.com";
const SCRIPT_TYPES = ["module", "text/javascript", "application/javascript"];
// BlogLayout's per-page directives (plan §1.13, J6): legacy post images and
// the YouTube, diagrams.net and nbviewer embeds, on dist/blog/** only.
const BLOG_PAGES = "dist/blog/";
const BLOG_IMG_SRC = [
	"'self'",
	"data:",
	"https://d1d7p8ufhgz4ld.cloudfront.net",
];
const BLOG_FRAME_SRC = [
	"https://www.youtube.com",
	"https://www.youtube-nocookie.com",
	"https://viewer.diagrams.net",
	"https://nbviewer.org",
];

async function readBuiltPages() {
	const files = await globby("dist/**/*.html");
	return Promise.all(
		files.map(async (file) => ({
			file,
			html: await fs.readFile(file, "utf8"),
		})),
	);
}

function findMetaPolicy(document) {
	return document.head.querySelector(
		'meta[http-equiv="content-security-policy"]',
	);
}

// Fetch directives fall back to default-src; no list at all means unrestricted.
function imageSources(directives) {
	return directives.get("img-src") ?? directives.get("default-src");
}

// Supports 'self', *, scheme sources and bare scheme+host sources; any other
// source form never matches, so an unsupported policy fails closed.
function allowsUrl(sources, url) {
	if (!sources) return true;
	return sources.some((source) => {
		if (source === "'self'") return url.origin === SITE_ORIGIN;
		if (source === "*") return ["http:", "https:"].includes(url.protocol);
		if (SCHEME_SOURCE.test(source)) {
			return url.protocol === source.toLowerCase();
		}
		if (!URL.canParse(source)) return false;
		const host = new URL(source);
		return host.pathname === "/" && host.origin === url.origin;
	});
}

function imageUrls(document) {
	const urls = [];
	for (const element of document.querySelectorAll(
		"img[src], img[srcset], source[srcset]",
	)) {
		const src = element.getAttribute("src");
		if (src) urls.push(src);
		for (const candidate of (element.getAttribute("srcset") ?? "").split(",")) {
			const [candidateUrl] = candidate.trim().split(WHITESPACE);
			if (candidateUrl) urls.push(candidateUrl);
		}
	}
	return urls.map((value) => new URL(value, `${SITE_ORIGIN}/`));
}

it("final built pages authorize Astro bootstrap through hashes and retain CSP", async () => {
	const pages = await readBuiltPages();
	assert.ok(pages.length > 0, "built HTML is required");
	for (const { file, html } of pages) {
		const dom = new JSDOM(html);
		try {
			const meta = findMetaPolicy(dom.window.document);
			assert.ok(meta, `${file}: policy is in the head`);
			const directives = parseDirectives(meta.getAttribute("content"));
			assert.ok(
				directives.get("default-src")?.includes("'self'"),
				`${file}: default resource restriction`,
			);
			const scriptSources = directives.get("script-src");
			assert.ok(scriptSources?.length, `${file}: script policy exists`);
			assert.ok(
				!scriptSources.includes("'unsafe-inline'") &&
					!scriptSources.includes("'unsafe-eval'"),
				`${file}: arbitrary code stays blocked`,
			);
			for (const script of dom.window.document.querySelectorAll(
				"script:not([src])",
			)) {
				if (script.type && !SCRIPT_TYPES.includes(script.type)) continue;
				if (!script.textContent) continue;
				const hash = createHash("sha256")
					.update(script.textContent)
					.digest("base64");
				assert.ok(
					scriptSources.includes(`'sha256-${hash}'`),
					`${file}: final script bytes are authorized after HTML processing`,
				);
				assert.ok(
					meta.compareDocumentPosition(script) &
						dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
					`${file}: policy precedes scripts`,
				);
			}
		} finally {
			dom.window.close();
		}
	}
});

it("every built page image loads under both the header and the page meta policy", async () => {
	const headerImages = imageSources(parseDirectives(await readHeaderPolicy()));
	const pages = await readBuiltPages();
	assert.ok(pages.length > 0, "built HTML is required");
	for (const { file, html } of pages) {
		const dom = new JSDOM(html);
		try {
			const meta = findMetaPolicy(dom.window.document);
			assert.ok(meta, `${file}: policy is in the head`);
			const metaImages = imageSources(
				parseDirectives(meta.getAttribute("content")),
			);
			for (const url of imageUrls(dom.window.document)) {
				const shown = url.href.slice(0, 80);
				assert.ok(
					allowsUrl(headerImages, url),
					`${file}: ${shown} needs a vercel.json header img-src source`,
				);
				assert.ok(
					allowsUrl(metaImages, url),
					`${file}: ${shown} needs a per-page img-src; the Astro meta falls back to default-src 'self'`,
				);
			}
		} finally {
			dom.window.close();
		}
	}
});

it("blog pages, and only blog pages, allow CloudFront post images and the four embed hosts in their meta policy", async () => {
	const pages = await readBuiltPages();
	const blogPages = pages.filter(({ file }) => file.startsWith(BLOG_PAGES));
	assert.ok(blogPages.length > 0, "built blog pages are required");
	for (const { file, html } of pages) {
		const dom = new JSDOM(html);
		try {
			const meta = findMetaPolicy(dom.window.document);
			assert.ok(meta, `${file}: policy is in the head`);
			const directives = parseDirectives(meta.getAttribute("content"));
			assert.deepEqual(
				{
					"img-src": directives.get("img-src") ?? null,
					"frame-src": directives.get("frame-src") ?? null,
				},
				file.startsWith(BLOG_PAGES)
					? { "img-src": BLOG_IMG_SRC, "frame-src": BLOG_FRAME_SRC }
					: { "img-src": null, "frame-src": null },
				`${file}: the meta widens img-src and frame-src on blog pages only`,
			);
		} finally {
			dom.window.close();
		}
	}
});
