// biome-ignore-all lint/performance/noAwaitInLoops: ordered browser interactions on one page.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};
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

const SIX_SERVINGS = /6 servings/su;
const PROTEINS = /^Proteins:/u;
const SMOOTHIE = /smoothie/iu;

function verifyLibrary(width) {
	it(`recipe search, aligned settings and individual card printing at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 984 },
			reducedMotion: "reduce",
			serviceWorkers: "block",
		});
		await context.addInitScript(() => {
			window.printPackets = [];
			window.print = () => {
				window.printPackets.push(
					document.querySelector(".print-output").textContent,
				);
			};
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(`${site.origin}/recipes/`);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			const servings = page.getByRole("combobox", {
				name: "Servings",
				exact: true,
			});
			const units = page.getByRole("combobox", { name: "Ingredient units" });
			const a = await servings.boundingBox();
			const b = await units.boundingBox();
			const wrapper = await page
				.locator('.servings-setting [data-slot="native-select-wrapper"]')
				.boundingBox();
			assert.ok(
				Math.abs(wrapper.width - a.width) < 2,
				"servings arrow stays inside its field",
			);
			assert.ok(
				width > 600 ? Math.abs(a.y - b.y) < 2 : b.y > a.y,
				`settings at ${width}px: ${a.y}, ${b.y}`,
			);
			const cardIds = () =>
				page
					.locator(".recipe-card a.title-button")
					.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
			assert.deepEqual(
				await cardIds(),
				data.recipes
					.filter((recipe) => recipe.type === "meal")
					.map((recipe) => recipe.id),
			);
			const diet = page.getByRole("combobox", { name: "Dietary preference" });
			await diet.selectOption("vegetarian");
			const beforeShuffle = await cardIds();
			await page.evaluate(() => {
				let seed = 1;
				Math.random = () => {
					seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
					return seed / 2 ** 32;
				};
			});
			await page.getByRole("button", { name: "Shuffle recipes" }).click();
			const afterShuffle = await cardIds();
			assert.notDeepEqual(afterShuffle, beforeShuffle);
			assert.deepEqual([...afterShuffle].sort(), [...beforeShuffle].sort());
			assert.equal(await diet.inputValue(), "vegetarian");
			await diet.selectOption("all");
			await servings.selectOption("6");
			await units.selectOption("metric");
			const search = page.getByRole("searchbox", { name: "Search recipes" });
			await search.fill("jalapeno popper stuffed");
			const cards = page.locator(".recipe-grid .recipe-card");
			await cards.first().waitFor();
			assert.ok((await cards.count()) > 0);
			const mealId = await cards
				.first()
				.locator("[data-recipe-id]")
				.getAttribute("data-recipe-id");
			await cards
				.first()
				.getByRole("button", { name: "Print recipe", exact: true })
				.focus();
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => window.printPackets.length === 1);
			assert.equal(await page.locator(".print-output .print-meal").count(), 1);
			assert.equal(
				await page.locator(".print-output .print-title").textContent(),
				data.recipes.find((recipe) => recipe.id === mealId).title,
			);
			assert.match(
				await page.locator(".print-output").textContent(),
				SIX_SERVINGS,
			);
			assert.equal(await page.getByRole("dialog").count(), 0);
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await page.waitForFunction(
				() => !document.querySelector(".print-output .print-meal"),
			);
			await search.fill("zzzznotaningredient");
			await page
				.getByText("No recipes match your search and filters.", {
					exact: false,
				})
				.waitFor();
			assert.equal(await cards.count(), 0);
			await search.fill("chikcen");
			await cards.first().waitFor();
			assert.ok((await cards.count()) > 0);
			await search.fill("");
			await page.getByRole("button", { name: PROTEINS }).click();
			await page.getByRole("checkbox", { name: "Fish", exact: true }).click();
			await page.keyboard.press("Escape");
			const fishOrder = await cards
				.locator("[data-recipe-id]")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
			assert.ok(fishOrder.length > 0);
			await search.fill("jalapeno popper stuffed");
			await page
				.getByText("No recipes match your search and filters.", {
					exact: false,
				})
				.waitFor();
			await search.fill("");
			await cards.first().waitFor();
			assert.deepEqual(
				await cards
					.locator("[data-recipe-id]")
					.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
				fishOrder,
			);
			await page.getByRole("link", { name: "Smoothies", exact: true }).click();
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			await search.fill("avocado lime");
			await cards.first().waitFor();
			assert.ok((await cards.count()) > 0);
			assert.match(await cards.first().textContent(), SMOOTHIE);
			const smoothieId = await cards
				.first()
				.locator("[data-recipe-id]")
				.getAttribute("data-recipe-id");
			await cards
				.first()
				.getByRole("button", { name: "Print recipe", exact: true })
				.click();
			await page.waitForFunction(() => window.printPackets.length === 1);
			assert.equal(await page.locator(".print-output .print-meal").count(), 1);
			assert.equal(
				await page.locator(".print-output .print-title").textContent(),
				data.recipes.find((recipe) => recipe.id === smoothieId).title,
			);
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			if (process.env.UI_EVIDENCE_DIR) {
				await mkdir(process.env.UI_EVIDENCE_DIR, { recursive: true });
				await page.goto(`${site.origin}/recipes/`);
				await page.waitForFunction(
					() => !document.querySelector("astro-island[ssr]"),
				);
				await page.getByRole("button", { name: PROTEINS }).click();
				const clear = page.getByRole("button", {
					name: "Clear selections",
					exact: true,
				});
				if (await clear.isEnabled()) await clear.click();
				await page.keyboard.press("Escape");
				for (const colorScheme of ["light", "dark"]) {
					await page.emulateMedia({ colorScheme });
					await page.evaluate(() => window.scrollTo(0, 0));
					await page.screenshot({
						path: `${process.env.UI_EVIDENCE_DIR}/recipe-library-${width}-${colorScheme}.png`,
						fullPage: false,
					});
					await cards.first().screenshot({
						path: `${process.env.UI_EVIDENCE_DIR}/recipe-card-${width}-${colorScheme}.png`,
					});
				}
			}
			assert.deepEqual(
				errors.filter(
					(error) =>
						error !== "Service Worker registration blocked by Playwright",
				),
				[],
			);
		} finally {
			await context.close();
		}
	});
}

verifyLibrary(390);
verifyLibrary(765);
verifyLibrary(1280);
