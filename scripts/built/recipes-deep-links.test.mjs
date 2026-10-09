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

const { recipes } = JSON.parse(await readFile(RECIPES, "utf8"));

// Give every cold link its own bounded test, so expanding the library does not
// turn a fixed aggregate timeout into a limit on the number of recipes covered.
function registerRecipeLink(recipe) {
	it(`old /recipes/#${recipe.id} opens its recipe dialog on the right collection`, {
		timeout: 30_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 800 },
		});
		const page = await context.newPage();
		const errors = collectErrors(page, []);
		try {
			await page.goto(`${site.origin}${LANDING}#${recipe.id}`);
			const section = page.locator(`.recipe-takeover section#${recipe.id}`);
			await section.waitFor();
			assert.equal(
				await section.getByRole("heading", { level: 2 }).textContent(),
				recipe.title,
			);
			assert.equal(await page.getByRole("dialog").isVisible(), true);
			assert.equal(
				await page.locator(".recipe-takeover").evaluate((dialog) => {
					const { top, left, height } = dialog.getBoundingClientRect();
					return top === 0 && left === 0 && height === window.innerHeight;
				}),
				true,
			);
			assert.equal(
				await page
					.getByRole("link", {
						name: COLLECTION_LINKS[recipe.type],
						exact: true,
						includeHidden: true,
					})
					.getAttribute("aria-current"),
				"true",
			);
			assert.equal(
				await page
					.getByRole("link", {
						name: COLLECTION_LINKS[
							recipe.type === "meal" ? "smoothie" : "meal"
						],
						exact: true,
						includeHidden: true,
					})
					.getAttribute("aria-current"),
				null,
			);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}

for (const recipe of recipes) registerRecipeLink(recipe);

it("old /recipes/#meal-results lands on the cards without a recipe dialog", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const page = await context.newPage();
	const errors = collectErrors(page, []);
	try {
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
