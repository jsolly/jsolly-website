// biome-ignore-all lint/performance/noAwaitInLoops: ordered browser interactions and fresh viewport contexts.

import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";

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
const hydrate = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
const RECIPE = "/recipes/lemon-salmon-and-asparagus/";
function verifyNavigation(width) {
	it(`Back restores collection history at ${width}px`, {
		timeout: 120_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 984 },
			reducedMotion: "reduce",
			serviceWorkers: "block",
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(`${site.origin}${RECIPE}?servings=6&units=metric`);
			await hydrate(page);
			assert.equal(
				await page
					.getByRole("button", { name: "Measurement assumptions" })
					.count(),
				0,
			);
			assert.equal(await page.locator('a[href*="/assumptions/"]').count(), 0);
			// Direct links go to the top of the collection rather than an old visit.
			await page
				.getByRole("link", { name: "Back to meals", exact: false })
				.click();
			await page.waitForURL("**/recipes/meals/");
			await hydrate(page);
			assert.equal(await page.evaluate(() => scrollY), 0);
			await page
				.getByRole("searchbox", { name: "Search recipes" })
				.fill("chicken");
			await page
				.getByRole("checkbox", { name: "Vegetarian", exact: true })
				.uncheck();
			assert.equal(
				await page.getByRole("checkbox", { name: "Keto", exact: true }).count(),
				0,
			);
			await page.getByRole("button", { name: "Shuffle meals" }).click();
			const ids = () =>
				page
					.locator(".recipe-card a.title-button")
					.evaluateAll((links) => links.map((node) => node.dataset.recipeId));
			await page
				.getByRole("button", { name: "Shuffle meals" })
				.waitFor({ state: "visible" });
			await page.waitForFunction(
				() => !document.querySelector('#meal-results[aria-busy="true"]'),
			);
			await page
				.getByRole("button", { name: "Load more recipes", exact: true })
				.click();
			const link = page.locator(".recipe-card a.title-button").nth(7);
			await link.scrollIntoViewIfNeeded();
			const order = await ids();
			assert.ok(order.length > 6);
			const beforeScroll = await page.evaluate(() => scrollY);
			assert.ok(beforeScroll > 500);
			// A legacy collection fragment does not change card navigation.
			await page.evaluate(() =>
				history.replaceState(history.state, "", "#meal-results"),
			);
			const source = page.url();
			const destination = await link.getAttribute("href");
			await link.click();
			await page.waitForURL(new URL(destination, site.origin).href);
			await hydrate(page);
			await page.locator(".recipe-detail").waitFor();
			await page.goBack();
			await page.waitForURL(source);
			await hydrate(page);
			// Back focuses the card link the visit left from, without scrolling.
			const opened = order[7];
			const restored = async () => {
				await page.waitForFunction(
					(id) =>
						document.activeElement?.matches(".recipe-card a.title-button") &&
						document.activeElement.dataset.recipeId === id,
					opened,
				);
				return {
					focused: await page.evaluate(
						() => document.activeElement?.dataset.recipeId,
					),
					...(await listState()),
				};
			};
			const listState = async () => ({
				search: await page
					.getByRole("searchbox", { name: "Search recipes" })
					.inputValue(),
				vegetarian: await page
					.getByRole("checkbox", { name: "Vegetarian", exact: true })
					.isChecked(),
				order: await ids(),
			});
			const expected = {
				focused: opened,
				search: "chicken",
				vegetarian: false,
				order,
			};
			assert.deepEqual(await restored(), expected);
			assert.ok(
				Math.abs((await page.evaluate(() => scrollY)) - beforeScroll) <= 2,
			);
			// Reloading a recipe must keep its collection-return entry as well as
			// browser Back, without relying on the removed units control.
			const changed = page.url();
			// Scroll the current reactive card atomically; summary prefetch may replace
			// its node while Playwright waits for a previous node's stability.
			await link.evaluate((node) =>
				node.scrollIntoView({ block: "center", behavior: "instant" }),
			);
			const leftAt = await page.evaluate(() => scrollY);
			const changedLink = await link.getAttribute("href");
			assert.equal(
				new URL(changedLink, site.origin).pathname,
				`/recipes/${opened}/`,
			);
			await link.click();
			await page.waitForURL(new URL(changedLink, site.origin).href);
			await hydrate(page);
			assert.equal(
				await page.getByRole("combobox", { name: "Ingredient units" }).count(),
				0,
			);
			await page.reload();
			await hydrate(page);
			await page
				.getByRole("link", { name: "Back to meals", exact: false })
				.click();
			await page.waitForURL(changed);
			await hydrate(page);
			assert.deepEqual(await restored(), expected);
			assert.ok(Math.abs((await page.evaluate(() => scrollY)) - leftAt) <= 2);
			// Playwright emits this harness warning when a production worker is intentionally blocked.
			assert.deepEqual(
				errors.filter(
					(message) =>
						message !== "Service Worker registration blocked by Playwright",
				),
				[],
			);
		} finally {
			await context.close();
		}
		const native = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width, height: 984 },
		});
		try {
			const nativePage = await native.newPage();
			await nativePage.goto(`${site.origin}${RECIPE}`);
			assert.equal(
				await nativePage.locator('a[href*="/assumptions/"]').count(),
				0,
			);
			await nativePage
				.getByRole("link", { name: "Back to meals", exact: false })
				.click();
			await nativePage.waitForURL("**/recipes/meals/");
		} finally {
			await native.close();
		}
	});
}
for (const width of [390, 1280]) verifyNavigation(width);
