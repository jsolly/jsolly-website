import fs from "node:fs/promises";
import { globby } from "globby";
import { minify } from "html-minifier-terser";
import { JSDOM } from "jsdom";

const HEADING_SLUG_SPACES = /[\s.,?:]+/gu;
const HEADING_SLUG_TRAILING_DASH = /-+$/u;

// Islands hydrate only when the server-rendered DOM survives minification:
// Svelte's block markers (`[`, `]`), empty anchors and `$props.id()` markers
// (`$`) must stay, as must Astro's `astro:end`, which lets islands start
// before DOMContentLoaded. Conservative collapse keeps one space where
// whitespace was, so text nodes still line up with the client render.
// scripts/built/hydration.test.mjs pins it.
const MINIFY_OPTIONS = {
	removeComments: true,
	ignoreCustomComments: [/^\[/u, /^\]/u, /^$/u, /^\$/u, /^astro:end$/u],
	preserveLineBreaks: true,
	collapseWhitespace: true,
	conservativeCollapse: true,
};

// Get all HTML files from the output directory
const path = "./dist";
const files = await globby(`${path}/**/*.html`);

await Promise.all(
	files.map(async (file) => {
		console.info("Processing file:", file);
		let html = await fs.readFile(file, "utf-8");

		// Add IDs to h2, h3, and h4 tags
		const dom = new JSDOM(html);
		const headings = dom.window.document.querySelectorAll("h2, h3, h4");
		for (const heading of headings) {
			// Respect hand-written ids (e.g. aria-labelledby targets); only generate when missing.
			if (heading.id) continue;
			const text = heading.textContent;
			if (!text) continue;
			const id = text
				.trim()
				.replace(HEADING_SLUG_SPACES, "-")
				.replace(HEADING_SLUG_TRAILING_DASH, "")
				.toLowerCase();
			heading.setAttribute("id", id);
		}
		html = dom.serialize();

		// Minify the HTML
		html = await minify(html, MINIFY_OPTIONS);
		await fs.writeFile(file, html);
	}),
);
