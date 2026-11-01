import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { it } from "vitest";

// Published fragments predate explicit source ids. Keep these addresses stable
// when heading copy changes; do not derive expectations from that copy.
const FRAGMENTS = {
	"index.html": [
		"hero-heading",
		"about-this-site-heading",
		"pages-on-this-site-heading",
		"for-agents-heading",
		"testimonials-heading",
	],
	"about/index.html": ["contact-me-heading"],
	"contact/index.html": ["contact-me-heading"],
	"privacy/index.html": [
		"contact-form",
		"hosting-&-logs",
		"error-reports",
		"blog-images",
		"embedded-media",
		"recipe-settings-&-offline-use",
		"scripts-&-styles",
		"links-to-other-sites",
		"cookies",
		"children",
		"questions",
	],
	"terms/index.html": [
		"use-and-reuse",
		"no-signup-no-fees",
		"as-is",
		"contact",
	],
	"404.html": [],
	"500.html": [],
};

it("portfolio headings retain their published fragment addresses", async () => {
	await Promise.all(
		Object.entries(FRAGMENTS).map(async ([file, expected]) => {
			const dom = new JSDOM(
				await readFile(new URL(`../../dist/${file}`, import.meta.url), "utf8"),
			);
			try {
				const headings = [
					...dom.window.document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
				];
				assert.deepEqual(
					headings.map((heading) => heading.id).filter(Boolean),
					expected,
					file,
				);
				assert.equal(
					new Set(expected).size,
					expected.length,
					`${file}: fragments are unique`,
				);
			} finally {
				dom.window.close();
			}
		}),
	);
});
