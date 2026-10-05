import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { createTempCopy } from "./temp-copy.mjs";

// `npm run build:maintenance` (MAINTENANCE_MODE=true) must take the whole site
// offline, blog pages included: BlogLayout honors the flag the way the
// portfolio's Layout.astro does (plan §1.13). The build runs in a temp copy,
// so the real dist/ stays the normal build.
const WHITESPACE = /\s+/gu;
const MAINTENANCE_HEADING = "Under Maintenance";
// Text only the works-cited page body carries.
const POST_TEXT = "I freaking love MDN";

let copy;
let pages;

before(async () => {
	copy = await createTempCopy("maintenance");
	const result = copy.npmRun("build:maintenance");
	if (result.status !== 0) {
		throw new Error(
			`npm run build:maintenance in ${copy.dir} failed:\n${result.stdout}${result.stderr}`,
		);
	}
	const dist = join(copy.dir, "dist");
	const files = await globby("**/*.html", { cwd: dist });
	pages = await Promise.all(
		files.map(async (file) => {
			const html = await readFile(join(dist, file), "utf8");
			const dom = new JSDOM(html);
			try {
				const main = dom.window.document.querySelector("main");
				return {
					file,
					html,
					main: main?.textContent.replace(WHITESPACE, " ").trim() ?? null,
				};
			} finally {
				dom.window.close();
			}
		}),
	);
});

after(async () => {
	await copy?.remove();
});

it("a maintenance build shows only the maintenance notice on every page, blog pages included", () => {
	assert.ok(
		pages.some(({ file }) => file === "blog/works-cited/index.html"),
		"the maintenance build includes the blog pages",
	);
	const contents = new Set(pages.map(({ main }) => main));
	assert.equal(
		contents.size,
		1,
		`every page's <main> holds the same maintenance notice; found ${JSON.stringify([...contents])}`,
	);
	const [notice] = contents;
	assert.ok(
		notice?.includes(MAINTENANCE_HEADING),
		`<main> is the maintenance notice: ${notice}`,
	);
	assert.deepEqual(
		pages
			.filter(({ html }) => html.includes(POST_TEXT))
			.map(({ file }) => file),
		[],
		"pages that still render post text",
	);
});
