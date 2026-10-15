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
	it(`assumptions retain recipe context and Back restores collection history at ${width}px`, {
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
			const url = page.url();
			const help = page.getByRole("button", {
				name: "Measurement assumptions",
				exact: true,
			});
			await help.focus();
			await page.keyboard.press("Enter");
			const dialog = page.getByRole("dialog", {
				name: "Measurement assumptions",
				exact: true,
			});
			await dialog.waitFor();
			assert.equal(page.url(), url);
			assert.equal(
				await page
					.getByRole("combobox", { name: "Servings", exact: true })
					.inputValue(),
				"6",
			);
			await page.keyboard.press("Escape");
			await dialog.waitFor({ state: "detached" });
			assert.equal(
				await help.evaluate((node) => node === document.activeElement),
				true,
			);
			assert.equal(
				await page
					.getByRole("combobox", { name: "Ingredient units" })
					.inputValue(),
				"metric",
			);
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
				.getByRole("combobox", { name: "Dietary preference" })
				.selectOption("all");
			await page.getByRole("button", { name: "Shuffle recipes" }).click();
			const ids = () =>
				page
					.locator(".recipe-card a.title-button")
					.evaluateAll((links) => links.map((node) => node.dataset.recipeId));
			await page
				.getByRole("button", { name: "Shuffle recipes" })
				.waitFor({ state: "visible" });
			await page.waitForFunction(
				() => !document.querySelector('#meal-results[aria-busy="true"]'),
			);
			await page
				.getByRole("button", { name: "Load more recipes", exact: true })
				.click();
			const link = page.locator(".recipe-card a.title-button").nth(28);
			await link.scrollIntoViewIfNeeded();
			const order = await ids();
			assert.ok(order.length > 24);
			const beforeScroll = await page.evaluate(() => scrollY);
			assert.ok(beforeScroll > 500);
			const source = page.url();
			await link.click();
			await hydrate(page);
			await page
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
					.getByRole("combobox", { name: "Dietary preference" })
					.inputValue(),
				"all",
			);
			assert.deepEqual(await ids(), order);
			assert.ok(
				Math.abs((await page.evaluate(() => scrollY)) - beforeScroll) <= 2,
			);
			// The assumptions dialog can also open over the library's recipe dialog.
			await page.goto(`${site.origin}/recipes/#lemon-salmon-and-asparagus`);
			await hydrate(page);
			const recipeDialog = page.getByRole("dialog", {
				name: "Lemon salmon and asparagus",
				exact: true,
			});
			await recipeDialog.waitFor();
			await recipeDialog
				.getByRole("button", { name: "Measurement assumptions" })
				.click();
			await dialog.waitFor();
			await dialog.getByRole("button", { name: "Close and continue" }).click();
			await dialog.waitFor({ state: "detached" });
			assert.equal(await recipeDialog.isVisible(), true);
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
			await nativePage
				.getByRole("link", { name: "Measurement assumptions", exact: true })
				.click();
			await nativePage.waitForURL(`**${RECIPE}assumptions/`);
			assert.equal(
				await nativePage.getByRole("heading", { level: 1 }).textContent(),
				"Measurement assumptions",
			);
			assert.equal(
				await nativePage
					.getByRole("link", { name: "Back to recipe", exact: false })
					.getAttribute("href"),
				RECIPE,
			);
			await nativePage
				.getByRole("link", { name: "Back to recipe", exact: false })
				.click();
			await nativePage.waitForURL(`**${RECIPE}`);
		} finally {
			await native.close();
		}
	});
}
for (const width of [390, 1280]) verifyNavigation(width);
