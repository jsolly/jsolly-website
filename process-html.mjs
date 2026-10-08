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

// Svelte ends a <select> or <option> whose content is a snippet or component
// with `<!>`, an empty comment html-minifier cannot parse. `<!---->` parses to
// the same empty comment node, which the empty-anchor rule above keeps.
const RICH_SELECT_ANCHOR = /<!>(?=<\/(?:select|option)>)/gu;

// Blog and recipe pages get their heading ids from the article renderer
// (src/lib/blog/html.ts), and old links and feeds point at those ids, so
// the id pass leaves these pages alone.
// scripts/unit/process-html-ids.test.mjs pins it.
const ID_PASS_SKIPPED = ["blog/", "recipes/"];

// Add IDs to id-less h2, h3 and h4 tags.
function addHeadingIds(html) {
	const dom = new JSDOM(html);
	const headings = dom.window.document.querySelectorAll("h2, h3, h4");
	for (const heading of headings) {
		// Respect hand-written ids (e.g. aria-labelledby targets); only generate when missing.
		if (heading.id) continue;
		const id = heading.textContent
			.trim()
			.replace(HEADING_SLUG_SPACES, "-")
			.replace(HEADING_SLUG_TRAILING_DASH, "")
			.toLowerCase();
		// A punctuation-only heading has no slug; an empty id would be invalid.
		if (id) heading.setAttribute("id", id);
	}
	return dom.serialize();
}

// The output directory: dist/, or a fixture tree in tests.
const root = process.argv[2] ?? "./dist";
const files = await globby("**/*.html", { cwd: root });

await Promise.all(
	files.map(async (relative) => {
		const file = `${root}/${relative}`;
		console.info("Processing file:", file);
		let html = await fs.readFile(file, "utf-8");
		if (!ID_PASS_SKIPPED.some((dir) => relative.startsWith(dir))) {
			html = addHeadingIds(html);
		}

		// Minify the HTML
		html = await minify(
			html.replace(RICH_SELECT_ANCHOR, "<!---->"),
			MINIFY_OPTIONS,
		);
		await fs.writeFile(file, html);
	}),
);
