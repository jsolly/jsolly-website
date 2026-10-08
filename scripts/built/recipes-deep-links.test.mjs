import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { collectErrors, serveStatic } from "./pages.mjs";

// Plan §1.6: blogthedata.com's Easy Meals & Smoothies post now 301s to
// /recipes/, and browsers carry the #fragment across the redirect. The post
// rendered the whole library, so each #<recipe-id> (smoothies included)
// opened that recipe, and #meal-results jumped to the cards. Each link is
// opened cold, as a redirect lands it, not as an in-page hash change.
const DIST = "dist";
const LANDING = "/recipes/";
const RECIPES = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const COLLECTION_LINKS = { meal: "Meals", smoothie: "Smoothies" };

let site;
let browser;

before(async () => {
	site = await serveStatic(DIST);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

it("each old /recipes/#<recipe-id> link opens that recipe in the library dialog on its collection, and #meal-results lands on the cards", {
	timeout: 120_000,
}, async () => {
	const { recipes } = JSON.parse(await readFile(RECIPES, "utf8"));
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const page = await context.newPage();
	const errors = collectErrors(page, []);
	try {
		const opened = [];
		for (const recipe of recipes) {
			// biome-ignore lint/performance/noAwaitInLoops: each link opens cold in the one page, in turn
			await page.goto("about:blank");
			await page.goto(`${site.origin}${LANDING}#${recipe.id}`);
			const section = page.locator(`.recipe-takeover section#${recipe.id}`);
			await section.waitFor();
			opened.push({
				id: recipe.id,
				title: await section.getByRole("heading", { level: 2 }).textContent(),
				dialogOpen: await page.getByRole("dialog").isVisible(),
				// The dialog covers the viewport rather than its centred default.
				fillsViewport: await page
					.locator(".recipe-takeover")
					.evaluate((dialog) => {
						const { top, left, height } = dialog.getBoundingClientRect();
						return top === 0 && left === 0 && height === window.innerHeight;
					}),
				collection: await page
					.getByRole("link", {
						name: COLLECTION_LINKS[recipe.type],
						exact: true,
						includeHidden: true,
					})
					.getAttribute("aria-current"),
				otherCollection: await page
					.getByRole("link", {
						name: COLLECTION_LINKS[
							recipe.type === "meal" ? "smoothie" : "meal"
						],
						exact: true,
						includeHidden: true,
					})
					.getAttribute("aria-current"),
			});
		}
		assert.deepEqual(
			opened,
			recipes.map((recipe) => ({
				id: recipe.id,
				title: recipe.title,
				dialogOpen: true,
				fillsViewport: true,
				// The landing shows either collection, so neither link is the page.
				collection: "true",
				otherCollection: null,
			})),
		);

		await page.goto("about:blank");
		await page.goto(`${site.origin}${LANDING}#meal-results`);
		await page.locator("[data-hydrated=true]").waitFor();
		assert.deepEqual(
			await page.evaluate(() => {
				const target = document.querySelector(":target");
				const { top } = target?.getBoundingClientRect() ?? { top: -1 };
				return {
					target: target?.id,
					inView: top >= 0 && top < window.innerHeight,
					dialogs: document.querySelectorAll(".recipe-takeover").length,
				};
			}),
			{ target: "meal-results", inView: true, dialogs: 0 },
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
