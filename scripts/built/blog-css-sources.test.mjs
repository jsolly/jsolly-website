import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { globby } from "globby";
import { JSDOM } from "jsdom";

// The blog's Tailwind entry, src/styles/blog/ui.css, imports Tailwind with
// source(none) and names its own @source paths (plan §1.13), and Tailwind
// silently ignores a path that does not exist: a moved component would just
// lose its utilities. This test pins the paths, the shared layer order that
// keeps the blog layers last, and the built BlogLayout bundle.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE = /^@source\s+(?:not\s+)?"(?<path>[^"]+)";/gmu;
const COMMENT = /\/\*[\s\S]*?\*\//gu;
const LAYER_ORDER =
	"@layer properties, theme, base, components, utilities, blog, blog-no-script;";
const BLOG_PAGE = "dist/blog/works-cited/index.html";
const PORTFOLIO_PAGE = "dist/about/index.html";
// One selector per source the bundle depends on: an input.svelte utility
// (ui.css's ../../lib/components/ui source), the search wrapper's utility
// (its BlogNavigation.svelte source), a blog.css rule and a theme.css token.
const PINNED = [
	".placeholder\\:text-muted-foreground",
	".contents{",
	".site-header{",
	"--paper:",
];

// A rule only main.css emits (components.css), never the blog bundle.
const PORTFOLIO_ONLY = ".secondary-btn";

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

// The stylesheets a built page loads with JavaScript on (not its <noscript>).
function stylesheets(html) {
	const dom = new JSDOM(html);
	try {
		return [...dom.window.document.querySelectorAll("link")]
			.filter((link) => link.rel === "stylesheet" && !link.closest("noscript"))
			.map((link) => link.getAttribute("href"));
	} finally {
		dom.window.close();
	}
}

it("the blog stylesheets name only existing Tailwind sources, keep one layer order, and build the BlogLayout bundle apart from the portfolio's", async () => {
	const sheets = await globby(
		["src/styles/blog/*.css", "src/styles/recipes/*.css"],
		{
			cwd: ROOT,
		},
	);
	assert.ok(sheets.length > 0, "blog stylesheets exist");
	const texts = await Promise.all(
		sheets.map(async (sheet) => ({
			sheet,
			css: await readFile(join(ROOT, sheet), "utf8"),
		})),
	);
	const misordered = texts
		.filter(
			({ css }) =>
				!css.replace(COMMENT, "").trimStart().startsWith(LAYER_ORDER),
		)
		.map(({ sheet }) => sheet);
	const sources = texts.flatMap(({ sheet, css }) =>
		[...css.matchAll(SOURCE)].map((match) => ({
			sheet,
			path: resolve(ROOT, dirname(sheet), match.groups.path),
		})),
	);
	assert.deepEqual(
		misordered,
		[],
		`every blog and recipes stylesheet opens with ${LAYER_ORDER}`,
	);
	assert.ok(
		sources.some(({ sheet }) => sheet === "src/styles/blog/ui.css"),
		"ui.css names its Tailwind sources",
	);
	const missing = (
		await Promise.all(
			sources.map(async ({ sheet, path }) =>
				(await exists(path)) ? [] : [`${sheet}: ${path}`],
			),
		)
	).flat();
	assert.deepEqual(missing, [], "@source paths that Tailwind would ignore");

	const [blogSheets, portfolioSheets] = await Promise.all(
		[BLOG_PAGE, PORTFOLIO_PAGE].map(async (page) =>
			stylesheets(await readFile(join(ROOT, page), "utf8")),
		),
	);
	assert.ok(blogSheets.length > 0, `${BLOG_PAGE} loads a stylesheet`);
	assert.ok(portfolioSheets.length > 0, `${PORTFOLIO_PAGE} loads a stylesheet`);
	assert.deepEqual(
		blogSheets.filter((href) => portfolioSheets.includes(href)),
		[],
		"blog pages do not load the portfolio stylesheet",
	);
	const [bundle, portfolioBundle] = await Promise.all(
		[blogSheets, portfolioSheets].map(async (hrefs) =>
			(
				await Promise.all(
					hrefs.map((href) => readFile(join(ROOT, "dist", href), "utf8")),
				)
			).join("\n"),
		),
	);
	assert.ok(
		portfolioBundle.includes(PORTFOLIO_ONLY),
		`the portfolio bundle emits ${PORTFOLIO_ONLY}`,
	);
	assert.ok(
		!bundle.includes(PORTFOLIO_ONLY),
		`the BlogLayout bundle carries the portfolio's ${PORTFOLIO_ONLY}`,
	);
	assert.deepEqual(
		PINNED.filter((selector) => !bundle.includes(selector)),
		[],
		"the BlogLayout bundle lost pinned selectors",
	);
});
