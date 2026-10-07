import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { JSDOM } from "jsdom";

// Layout.astro: a noindex page (404, 500) answers whatever URL failed, so it
// names no URL of its own. Before B22 its canonical, og:url and twitter:url
// pointed at /404/ and /500/, which are not pages. An indexable page keeps
// all three.
const DIST = "dist";
const SELF_URLS = {
	// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
	canonical: 'link[rel="canonical"]',
	"og:url": 'meta[property="og:url"]',
	"twitter:url": 'meta[name="twitter:url"]',
	// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
	"Markdown alternate": 'link[rel="alternate"][type="text/markdown"]',
};

// Which of SELF_URLS the built file `file` carries.
async function selfUrls(file) {
	const dom = new JSDOM(await readFile(join(DIST, file), "utf8"));
	try {
		const { document } = dom.window;
		return Object.entries(SELF_URLS)
			.filter(([, selector]) => document.querySelector(selector))
			.map(([name]) => name);
	} finally {
		dom.window.close();
	}
}

it("error pages name no URL of their own, while indexable pages keep canonical, og:url and twitter:url", async () => {
	assert.deepEqual(await selfUrls("404.html"), [], "the 404 page's self URLs");
	assert.deepEqual(await selfUrls("500.html"), [], "the 500 page's self URLs");
	assert.deepEqual(
		await selfUrls("index.html"),
		["canonical", "og:url", "twitter:url", "Markdown alternate"],
		"the home page's self URLs",
	);
});
