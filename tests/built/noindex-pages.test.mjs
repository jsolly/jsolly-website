import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { it } from "vitest";
import { DIST, publishedPosts } from "./pages.mjs";

// Layout.astro: a noindex page (404, 500) answers whatever URL failed, so it
// names no URL of its own. Before B22 its canonical, og:url and twitter:url
// pointed at /404/ and /500/, which are not pages. Indexable pages keep
// theirs: the portfolio Layout writes all three plus the Markdown sibling,
// BlogLayout writes canonical, og:url and the Markdown sibling.
const NOINDEX = /\bnoindex\b/u;
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const ROBOTS = 'meta[name="robots"]';
const SELF_URLS = {
	// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
	canonical: 'link[rel="canonical"]',
	"og:url": 'meta[property="og:url"]',
	"twitter:url": 'meta[name="twitter:url"]',
	// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
	"Markdown alternate": 'link[rel="alternate"][type="text/markdown"]',
};

// The built file's robots meta and which of SELF_URLS it carries.
async function head(file) {
	const dom = new JSDOM(await readFile(join(DIST, file), "utf8"));
	try {
		const { document } = dom.window;
		return {
			robots: document.querySelector(ROBOTS)?.getAttribute("content") ?? null,
			selfUrls: Object.entries(SELF_URLS)
				.filter(([, selector]) => document.querySelector(selector))
				.map(([name]) => name),
		};
	} finally {
		dom.window.close();
	}
}

// [file, head(file)] for each file, read in parallel.
function heads(files) {
	return Promise.all(files.map(async (file) => [file, await head(file)]));
}

it("error pages are noindex and name no URL of their own, while indexable pages keep their self URLs", async () => {
	const errorPages = ["404.html", "500.html"];
	for (const [file, { robots, selfUrls }] of await heads(errorPages)) {
		assert.match(robots ?? "", NOINDEX, `${file} robots meta`);
		assert.deepEqual(selfUrls, [], `${file} self URLs`);
	}
	const [post] = (await publishedPosts())
		.map(({ slug }) => slug)
		.toSorted((a, b) => a.localeCompare(b, "en"));
	const portfolio = [
		"canonical",
		"og:url",
		"twitter:url",
		"Markdown alternate",
	];
	const expected = {
		"index.html": portfolio,
		"about/index.html": portfolio,
		[`blog/${post}/index.html`]: ["canonical", "og:url", "Markdown alternate"],
	};
	const indexable = await heads(Object.keys(expected));
	for (const [file, page] of indexable) {
		const selfUrls = expected[file];
		assert.equal(page.robots, null, `${file} is indexable`);
		assert.deepEqual(page.selfUrls, selfUrls, `${file} self URLs`);
	}
});
