import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { exists, stylesheets } from "./pages.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE = /^@source\s+(?:not\s+)?"(?<path>[^"]+)";/gmu;
const COMMENT = /\/\*[\s\S]*?\*\//gu;
const ORDER =
	"@layer properties, theme, base, components, utilities, blog, blog-no-script;";

it("portfolio, blog and recipes share the shell's UI sources and preserve scoped article styles", async () => {
	const sheets = await globby(
		["src/styles/blog/*.css", "src/styles/recipes/*.css"],
		{ cwd: ROOT },
	);
	assert.ok(sheets.length > 0);
	const cssSources = await Promise.all(
		sheets.map(async (sheet) => ({
			sheet,
			css: await readFile(join(ROOT, sheet), "utf8"),
		})),
	);
	assert.deepEqual(
		cssSources
			.filter(
				({ css }) => !css.replace(COMMENT, "").trimStart().startsWith(ORDER),
			)
			.map(({ sheet }) => sheet),
		[],
		"content sheets preserve layer order",
	);
	const main = await readFile(join(ROOT, "src/styles/main.css"), "utf8");
	const paths = [...main.matchAll(SOURCE)].map((match) =>
		resolve(ROOT, "src/styles", match.groups.path),
	);
	assert.deepEqual(
		(
			await Promise.all(
				paths.map(async (path) => ((await exists(path)) ? [] : [path])),
			)
		).flat(),
		[],
		"Tailwind sources exist",
	);
	assert.ok(
		main.includes("source(none)"),
		"no prose or documentation auto-detection",
	);
	const entries = await globby("src/styles/**/*.css", { cwd: ROOT });
	const tailwindEntries = (
		await Promise.all(
			entries.map(async (path) => ({
				path,
				css: await readFile(join(ROOT, path), "utf8"),
			})),
		)
	).filter(({ css }) => css.includes("source(none)"));
	assert.deepEqual(
		tailwindEntries.map(({ path }) => path),
		["src/styles/main.css"],
		"one Tailwind entry owns all sections",
	);

	const pages = await Promise.all(
		[
			"about/index.html",
			"blog/works-cited/index.html",
			"recipes/greek-turkey-patties/index.html",
		].map(async (page) => {
			const html = await readFile(join(ROOT, "dist", page), "utf8");
			const doc = new JSDOM(html).window.document;
			const bundle = (
				await Promise.all(
					stylesheets(html).map((href) =>
						readFile(join(ROOT, "dist", href), "utf8"),
					),
				)
			).join("\n");
			return { page, doc, bundle };
		}),
	);
	for (const { page, doc, bundle } of pages) {
		assert.equal(
			doc.querySelectorAll('nav[aria-label="Primary navigation"]').length,
			1,
			page,
		);
		assert.equal(
			doc.querySelectorAll('nav[aria-label="Footer navigation"]').length,
			1,
			page,
		);
		assert.equal(doc.querySelectorAll("main#main").length, 1, page);
		for (const selector of [
			".secondary-btn",
			".skip-link",
			"--color-text-primary:",
			"--paper:",
		]) {
			assert.ok(bundle.includes(selector), `${page} has shared ${selector}`);
		}
		assert.equal(
			// biome-ignore lint/security/noSecrets: CSS selector for a public manifest link.
			doc.querySelectorAll('link[rel="manifest"]').length,
			page.startsWith("blog/") ? 0 : 1,
			"section manifest ownership",
		);
	}
	const blog = pages.find(({ page }) => page.startsWith("blog/")).bundle;
	for (const selector of [
		".article-body",
		":where(.reading-section)",
		".category-options",
		".placeholder\\:text-muted-foreground",
	]) {
		assert.ok(blog.includes(selector), `blog content keeps ${selector}`);
	}
});
