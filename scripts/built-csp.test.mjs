import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { globby } from "globby";
import { parse } from "parse5";
import { beforeAll, it } from "vitest";
import { NOTEBOOK_RENDERS, readBuiltPages } from "./built/pages.mjs";
import { parseDirectives, readHeaderPolicy } from "./csp.mjs";

const WHITESPACE = /\s+/u;
const SCHEME_SOURCE = /^[a-z][a-z\d+.-]*:$/iu;
// The origin 'self' resolves to in production, and the base for relative URLs.
const SITE_ORIGIN = "https://www.jsolly.com";
const SCRIPT_TYPES = ["module", "text/javascript", "application/javascript"];
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
// BlogLayout's per-page directives (plan §1.13, J6): legacy post images and
// the YouTube, diagrams.net embeds and same-origin notebook frames, on dist/blog/** only.
// Page paths relative to dist/.
const BLOG_PAGES = "blog/";
const BLOG_IMG_SRC = [
	"'self'",
	"data:",
	"https://d1d7p8ufhgz4ld.cloudfront.net",
];
const BLOG_FRAME_SRC = [
	"'self'",
	"https://www.youtube-nocookie.com",
	"https://viewer.diagrams.net",
];

// Walk the parsed document tree, not template.content, just as document-level
// DOM selectors do. parse5 has already repaired malformed HTML and head order.
function* elements(node) {
	for (const child of node.childNodes ?? []) {
		if (child.tagName) yield child;
		yield* elements(child);
	}
}

function attribute(node, name) {
	return (
		node.attrs.find((attr) => attr.name === name && !attr.prefix)?.value ?? null
	);
}

function textContent(node) {
	if (node.nodeName === "#text") return node.value;
	return (node.childNodes ?? []).map(textContent).join("");
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

function pageFacts({ file, html }) {
	// JSDOM uses this same pinned HTML parser with scripting disabled. Reading
	// its tree directly avoids building windows, CSSOM and live DOM wrappers.
	const document = parse(html, { scriptingEnabled: false });
	const root = document.childNodes.find((node) => node.tagName === "html");
	const head = root.childNodes.find((node) => node.tagName === "head");
	const meta = [...elements(head)].find(
		(node) =>
			node.tagName === "meta" &&
			attribute(node, "http-equiv")?.toLowerCase() ===
				"content-security-policy",
	);
	const nodes = [...elements(document)];
	const policyIndex = nodes.indexOf(meta);
	const scripts = [];
	const urls = [];
	let scriptCount = 0;
	for (const [index, node] of nodes.entries()) {
		if (node.tagName === "script") {
			scriptCount++;
			if (attribute(node, "src") === null) {
				scripts.push(
					Object.freeze({
						// SVG scripts have no HTMLScriptElement.type property.
						type:
							node.namespaceURI === HTML_NAMESPACE
								? (attribute(node, "type") ?? "")
								: undefined,
						text: textContent(node),
						followsPolicy: policyIndex !== -1 && index > policyIndex,
					}),
				);
			}
		}
		if (node.tagName !== "img" && node.tagName !== "source") continue;
		const src = attribute(node, "src");
		const srcset = attribute(node, "srcset");
		if (srcset === null && (node.tagName === "source" || src === null))
			continue;
		if (src) urls.push(src);
		for (const candidate of (srcset ?? "").split(",")) {
			const [candidateUrl] = candidate.trim().split(WHITESPACE);
			if (candidateUrl) urls.push(candidateUrl);
		}
	}
	return Object.freeze({
		file,
		hasPolicy: meta !== undefined,
		policy: meta ? attribute(meta, "content") : undefined,
		scripts: Object.freeze(scripts),
		scriptCount,
		images: Object.freeze(urls),
	});
}

// These three checks inspect the same immutable build. Parse each page once,
// retaining parsed values rather than sharing live documents across tests.
// Each build invocation (including isolated maintenance/CMS builds) reads its
// own dist; nothing is cached across builds or test processes.
let pages;
beforeAll(async () => {
	pages = Object.freeze((await readBuiltPages()).map(pageFacts));
});

it("final built pages authorize Astro bootstrap through hashes and retain CSP", () => {
	assert.ok(pages.length > 0, "built HTML is required");
	for (const { file, hasPolicy, policy, scripts } of pages) {
		assert.ok(hasPolicy, `${file}: policy is in the head`);
		const directives = parseDirectives(policy);
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
		for (const script of scripts) {
			if (script.type && !SCRIPT_TYPES.includes(script.type)) continue;
			if (!script.text) continue;
			const hash = createHash("sha256").update(script.text).digest("base64");
			assert.ok(
				scriptSources.includes(`'sha256-${hash}'`),
				`${file}: final script bytes are authorized after HTML processing`,
			);
			assert.ok(script.followsPolicy, `${file}: policy precedes scripts`);
		}
	}
});

it("every built page image loads under both the header and the page meta policy", async () => {
	const headerImages = imageSources(parseDirectives(await readHeaderPolicy()));
	assert.ok(pages.length > 0, "built HTML is required");
	for (const { file, hasPolicy, policy, images } of pages) {
		assert.ok(hasPolicy, `${file}: policy is in the head`);
		const metaImages = imageSources(parseDirectives(policy));
		for (const href of images) {
			const url = new URL(href, `${SITE_ORIGIN}/`);
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
	}
});

it("blog pages, and only blog pages, allow CloudFront post images and the three embed hosts in their meta policy", () => {
	const blogPages = pages.filter(({ file }) => file.startsWith(BLOG_PAGES));
	assert.ok(blogPages.length > 0, "built blog pages are required");
	for (const { file, hasPolicy, policy } of pages) {
		assert.ok(hasPolicy, `${file}: policy is in the head`);
		const directives = parseDirectives(policy);
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
	}
});

it("static notebook renders ship no scripts and restrict themselves to their own images", async () => {
	const files = await globby(NOTEBOOK_RENDERS, { cwd: "dist" });
	assert.ok(files.length > 0, "built notebook renders are required");
	for (const file of files) {
		// biome-ignore lint/performance/noAwaitInLoops: bounded build pages are read sequentially.
		const html = await readFile(join("dist", file), "utf8");
		const facts = pageFacts({ file, html });
		assert.equal(
			facts.scriptCount,
			0,
			`${file}: a notebook render runs no scripts`,
		);
		assert.ok(facts.hasPolicy, `${file}: policy is in the head`);
		const directives = parseDirectives(facts.policy);
		assert.deepEqual(directives.get("script-src"), ["'none'"], file);
		assert.deepEqual(directives.get("img-src"), ["'self'", "data:"], file);
		assert.deepEqual(
			directives.get("style-src"),
			["'self'", "'unsafe-inline'"],
			file,
		);
	}
});
