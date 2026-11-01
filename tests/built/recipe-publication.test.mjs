import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import middleware from "../../middleware.js";
import retired from "../../src/components/recipes/retired-recipes.json" with {
	type: "json",
};
import { collectErrors, distFiles, readBuilt, serveStatic } from "./pages.mjs";

let site;
let browser;
before(async () => {
	site = await serveStatic("dist");
	browser = await chromium.launch();
});
after(async () => {
	await browser?.close();
	await site?.close();
});

it("retired recipe links preserve HTML and Markdown notices outside indexes and offline manifests", async () => {
	const files = await distFiles();
	const sitemap = await readFile("dist/sitemap-0.xml", "utf8");
	await Promise.all(
		retired.map(async (recipe) => {
			const path = `/recipes/${recipe.id}/`;
			const body = await readBuilt(`recipes/${recipe.id}`, (document) => ({
				title: document.querySelector("h1")?.textContent,
				text: document.querySelector("main")?.textContent,
				robots: [...document.querySelectorAll("meta")].find(
					({ name }) => name === "robots",
				)?.content,
				cooking: document.querySelectorAll(".recipe-body, .recipe-detail")
					.length,
			}));
			assert.equal(body.title, recipe.title);
			assert.ok(body.text.includes("no longer in the keto collection"));
			assert.ok(body.robots.includes("noindex"));
			assert.equal(body.cooking, 0);
			const markdown = await readFile(`dist/recipes/${recipe.id}.md`, "utf8");
			assert.ok(markdown.includes(recipe.title));
			assert.ok(markdown.includes("no longer in the keto collection"));
			assert.ok(!markdown.includes("## Ingredients"));
			assert.ok(!sitemap.includes(`https://www.jsolly.com${path}`));
			assert.ok(!files.has(`recipes/data/packs/${recipe.id}.json`));
			assert.ok(!files.has(`recipes/data/offline/${recipe.id}.json`));
			for (const [url, accept] of [
				[path, "text/html"],
				[path, "text/markdown"],
				[`/recipes/${recipe.id}.md`, "*/*"],
			]) {
				const response = middleware(
					new Request(`https://www.jsolly.com${url}`, { headers: { accept } }),
				);
				assert.equal(response.headers.get("x-robots-tag"), "noindex");
			}
		}),
	);
});

it("legacy retired meal and smoothie fragments open explicit notices instead of recipe dialogs", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		await Promise.all(
			[
				retired.find(({ type }) => type === "meal"),
				retired.find(({ type }) => type === "smoothie"),
			].map(async (recipe) => {
				const page = await context.newPage();
				const errors = collectErrors(page);
				await page.goto(`${site.origin}/recipes/#${recipe.id}`);
				await page.waitForURL(`${site.origin}/recipes/${recipe.id}/`);
				await page
					.getByRole("heading", { level: 1, name: recipe.title, exact: true })
					.waitFor();
				assert.equal(await page.getByRole("dialog").count(), 0);
				assert.ok(
					await page
						.getByText("This recipe is no longer in the keto collection", {
							exact: false,
						})
						.isVisible(),
				);
				assert.deepEqual(errors, []);
			}),
		);
	} finally {
		await context.close();
	}
});
