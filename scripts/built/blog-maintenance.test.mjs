import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { agentResponse } from "../../src/lib/agent-response.js";
import { exists, readBuiltPages, stylesheets } from "./pages.mjs";
import { createTempCopy, requireSuccess } from "./temp-copy.mjs";

// `npm run build:maintenance` (MAINTENANCE_MODE=true) must take the whole site
// offline, blog pages included: BlogLayout honors the flag the way the
// portfolio's Layout.astro does (plan §1.13). It ships no recipe service
// worker, so installed recipe apps keep their offline copy instead of
// precaching the notice (plan §1.6), and no recipe page offers the app. The
// build runs in a temp copy, so the real dist/ stays the normal build.
const WHITESPACE = /\s+/gu;
const MAINTENANCE_HEADING = "Under Maintenance";
// Text only the works-cited page body carries.
const POST_TEXT = "I freaking love MDN";
const BLOG_PAGE = "blog/works-cited/index.html";
const RECIPE_WORKER = "recipes/service-worker.js";
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const MANIFEST_LINK = 'link[rel="manifest"]';
// JSON-LD: a post page's head slot carries its BlogPosting.
const STRUCTURED_DATA = 'script[type="application/ld+json"]';
// Maintenance.astro's own utilities: the icon badge and icon sizes, the
// centred column and the badge colour. Without them the notice is unstyled
// and the icon fills the column.
const NOTICE_SELECTORS = [
	".size-20",
	".size-10",
	".min-h-maintenance",
	".text-center",
	".bg-primary-100",
];

let copy;
let pages;
let blogCss;
let workerBuilt;
let markdownPages;

before(async () => {
	copy = await createTempCopy("maintenance");
	requireSuccess(copy.npmRun("build:maintenance"));
	const dist = join(copy.dir, "dist");
	const { markdownRoutes } = await import(
		pathToFileURL(join(copy.dir, "src/generated/route-manifest.js")).href
	);
	markdownPages = await Promise.all(
		markdownRoutes.map(async ([key, file]) => ({
			key,
			file,
			body: await readFile(join(dist, file), "utf8"),
		})),
	);
	workerBuilt = await exists(join(dist, RECIPE_WORKER));
	pages = (await readBuiltPages(dist)).map(({ file, html }) => {
		const dom = new JSDOM(html);
		try {
			const main = dom.window.document.querySelector("main");
			return {
				file,
				html,
				stylesheets: stylesheets(html),
				main: main?.textContent.replace(WHITESPACE, " ").trim() ?? null,
				manifest: dom.window.document
					.querySelector(MANIFEST_LINK)
					?.getAttribute("href"),
				blogPostings: [
					...dom.window.document.querySelectorAll(STRUCTURED_DATA),
				].filter(
					(script) => JSON.parse(script.textContent)["@type"] === "BlogPosting",
				).length,
			};
		} finally {
			dom.window.close();
		}
	});
	const blog = pages.find(({ file }) => file === BLOG_PAGE);
	blogCss = blog
		? (
				await Promise.all(
					blog.stylesheets.map((href) =>
						readFile(join(copy.dir, "dist", href), "utf8"),
					),
				)
			).join("\n")
		: "";
});

after(async () => {
	await copy?.remove();
});

it("Maintenance hides every generated Markdown body and answers direct or negotiated GET/HEAD with 503", async () => {
	assert.ok(
		markdownPages.length ===
			pages.filter(
				({ file }) => file.startsWith("blog/") || file.startsWith("recipes/"),
			).length,
		"the maintenance contract covers every generated section page",
	);
	const previous = process.env.MAINTENANCE_MODE;
	process.env.MAINTENANCE_MODE = "true";
	try {
		await Promise.all(
			markdownPages.map(async ({ key, file, body }) => {
				assert.ok(
					body.startsWith("# Maintenance\n"),
					`${file} contains only maintenance Markdown`,
				);
				assert.ok(!body.includes(POST_TEXT));
				await Promise.all(
					["GET", "HEAD"].flatMap((method) =>
						[`${key}/`, file].map(async (path) => {
							const response = agentResponse(
								new Request(`https://www.jsolly.com${path}`, {
									method,
									headers: { accept: "text/markdown" },
								}),
								new Map(),
							);
							assert.equal(response?.status, 503, `${method} ${path}`);
							assert.equal(response.headers.get("vary"), "Accept");
							assert.equal(
								await response.text(),
								method === "HEAD" ? "" : body,
								`${method} ${path} serves the maintenance body`,
							);
						}),
					),
				);
			}),
		);
	} finally {
		if (previous === undefined) delete process.env.MAINTENANCE_MODE;
		else process.env.MAINTENANCE_MODE = previous;
	}
});

it("a maintenance build shows only the maintenance notice on every page, blog pages included, and ships no recipe service worker", () => {
	assert.ok(
		pages.some(({ file }) => file === BLOG_PAGE),
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
	assert.deepEqual(
		NOTICE_SELECTORS.filter((selector) => !blogCss.includes(selector)),
		[],
		`${BLOG_PAGE}: the blog stylesheet lacks the maintenance notice's rules`,
	);
	assert.equal(workerBuilt, false, `the build wrote dist/${RECIPE_WORKER}`);
	assert.deepEqual(
		pages
			.filter(({ manifest }) => manifest?.startsWith("/recipes/"))
			.map(({ file }) => file),
		[],
		"pages that link the recipe app's manifest",
	);
	assert.deepEqual(
		pages
			.filter(({ blogPostings }) => blogPostings > 0)
			.map(({ file }) => file),
		[],
		"pages that still carry a post's BlogPosting JSON-LD",
	);
});
