// biome-ignore-all lint/performance/noAwaitInLoops: ordered browser interactions and fresh viewport contexts.
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
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
			await page.getByRole("checkbox", { name: "Keto", exact: true }).uncheck();
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
			// Legacy collection fragments must not cancel canonical Forward navigation.
			await page.evaluate(() =>
				history.replaceState(history.state, "", "#meal-results"),
			);
			let source = page.url();
			const destination = await link.getAttribute("href");
			await link.click();
			await page.waitForURL(new URL(destination, site.origin).href);
			await page.locator(".recipe-takeover").waitFor();
			await page.goBack();
			await page.waitForURL(source);
			await page.locator(".recipe-takeover").waitFor({ state: "detached" });
			assert.deepEqual(await ids(), order);
			await page
				.getByRole("combobox", { name: "Ingredient units" })
				.selectOption("grams");
			source = page.url();
			await page.goForward();
			await page.waitForURL(new URL(destination, site.origin).href);
			await page.locator(".recipe-takeover").waitFor();
			await hydrate(page);
			assert.equal(
				await page
					.locator(".recipe-takeover")
					.getByRole("combobox", { name: "Ingredient units" })
					.inputValue(),
				new URL(destination, site.origin).searchParams.get("units") || "us",
			);
			await page
				.locator(".recipe-takeover")
				.getByRole("combobox", { name: "Ingredient units" })
				.selectOption("grams");
			await page.reload();
			await hydrate(page);
			await page
				.getByRole("link", { name: "Back to meals", exact: false })
				.click();
			await page.waitForURL(source);
			await hydrate(page);
			assert.equal(
				await page
					.getByRole("searchbox", { name: "Search recipes" })
					.inputValue(),
				"chicken",
			);
			assert.equal(
				await page
					.getByRole("checkbox", { name: "Vegetarian", exact: true })
					.isChecked(),
				false,
			);
			assert.deepEqual(await ids(), order);
			assert.ok(
				Math.abs((await page.evaluate(() => scrollY)) - beforeScroll) <= 2,
			);
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
