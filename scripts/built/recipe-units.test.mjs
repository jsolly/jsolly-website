import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { defaultAppliances } from "../../src/components/recipes/constants.mjs";
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
// Playwright emits this warning itself when the test deliberately blocks workers.
const applicationErrors = (messages) =>
	messages.filter(
		(message) =>
			message !== "Service Worker registration blocked by Playwright",
	);
const UNIT_CONTROL = "Ingredient units";
const SERVINGS = /^Servings/u;
const GRAMS = /340 g/u;
const IMPERIAL = /11.99 oz/u;
const LARGE_GRAMS = /1360 g/u;
const WEIGHING = /0.78 g/u;
const ready = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
function verifyUnits(width) {
	it(`units persist across pages, links, dialog, print and downloads at ${width}px`, {
		timeout: 90_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			reducedMotion: "reduce",
			acceptDownloads: true,
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		const prior = {
			servings: 8,
			units: "us",
			filters: {
				proteinChoice: ["fish"],
				ingredientChoice: ["hemp"],
				mealStyle: "all",
			},
			appliancesOnHand: defaultAppliances,
			familyChoice: { "shawarma-chicken-bowls": "pita_one" },
		};
		try {
			await page.goto(`${site.origin}/recipes/`);
			await ready(page);
			await page.evaluate(
				(saved) =>
					localStorage.setItem("recipes-settings-v1", JSON.stringify(saved)),
				prior,
			);
			await page.goto(
				`${site.origin}/recipes/lemon-salmon-and-asparagus/?units=us`,
			);
			await ready(page);
			const units = page.getByRole("combobox", { name: UNIT_CONTROL });
			await units.focus();
			await units.press("g");
			await units.press("Enter");
			assert.equal(await units.inputValue(), "grams");
			assert.equal(new URL(page.url()).searchParams.get("units"), "grams");
			await page.reload();
			await ready(page);
			assert.equal(await units.inputValue(), "grams");
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
			const flow = page.locator(".recipe-detail .trn-table");
			assert.match(await flow.textContent(), GRAMS);
			assert.match(await flow.textContent(), WEIGHING);
			const afterUnits = await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			);
			assert.deepEqual(afterUnits, { ...prior, units: "grams" });
			if (process.env.UI_EVIDENCE_DIR) {
				await mkdir(process.env.UI_EVIDENCE_DIR, { recursive: true });
				await page.screenshot({
					path: `${process.env.UI_EVIDENCE_DIR}/units-${width}-light.png`,
				});
				await page.emulateMedia({ colorScheme: "dark" });
				await page.screenshot({
					path: `${process.env.UI_EVIDENCE_DIR}/units-${width}-dark.png`,
				});
				await page.emulateMedia({ colorScheme: "light" });
			}
			const downloaded = page.waitForEvent("download");
			await page
				.getByRole("button", { name: "Download JSON", exact: true })
				.click();
			const file = await downloaded;
			const bundle = JSON.parse(await readFile(await file.path(), "utf8"));
			assert.equal(bundle.settings.units, "grams");
			assert.equal(bundle.settings.servings, 2);
			assert.equal(bundle.recipes[0].ingredients[0].quantity, "340 g");
			assert.equal(Object.hasOwn(bundle, "measurementPolicy"), false);
			assert.equal(
				Object.hasOwn(bundle.recipes[0], "measurementPolicy"),
				false,
			);
			assert.ok(
				bundle.recipes[0].ingredients.find(
					(row) => row.name === "Garlic powder",
				).source,
			);
			const markdownDownload = page.waitForEvent("download");
			await page
				.getByRole("button", { name: "Download Markdown", exact: true })
				.click();
			const markdownFile = await markdownDownload;
			const markdown = await readFile(await markdownFile.path(), "utf8");
			assert.ok(markdown.includes("Grams measures"));
			assert.ok(markdown.includes("- 340 g Skin-on salmon fillets"));
			assert.ok(!markdown.includes("weight unavailable"));

			await page.emulateMedia({ media: "print" });
			assert.match(
				await page.locator(".print-document .trn-table").textContent(),
				GRAMS,
			);
			await page.emulateMedia({ media: "screen" });
			await units.selectOption("metric");
			assert.match(await flow.textContent(), GRAMS);
			await units.selectOption("us");
			assert.match(await flow.textContent(), IMPERIAL);
			await units.selectOption("grams");
			await page.goto(`${site.origin}/recipes/meals/`);
			await ready(page);
			assert.equal(
				await page.getByRole("combobox", { name: UNIT_CONTROL }).inputValue(),
				"grams",
			);
			const restored = await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			);
			assert.deepEqual(restored.filters.proteinChoice, ["fish"]);
			assert.deepEqual(restored.filters.ingredientChoice, ["hemp"]);
			assert.deepEqual(restored.familyChoice, prior.familyChoice);
			const href = await page
				.locator('[data-recipe-id="lemon-salmon-and-asparagus"]')
				.getAttribute("href");
			assert.equal(
				new URL(href, site.origin).searchParams.get("units"),
				"grams",
			);
			await page.goto(
				`${site.origin}/recipes/?units=metric#lemon-salmon-and-asparagus`,
			);
			await ready(page);
			const dialog = page.getByRole("dialog");
			await dialog.waitFor();
			assert.equal(
				await dialog.getByRole("combobox", { name: UNIT_CONTROL }).inputValue(),
				"metric",
			);
			await dialog
				.getByRole("combobox", { name: UNIT_CONTROL })
				.selectOption("grams");
			assert.match(
				await dialog.locator(".trn-table").textContent(),
				LARGE_GRAMS,
			);
			await page.keyboard.press("Escape");
			assert.equal(
				await page.getByRole("combobox", { name: UNIT_CONTROL }).inputValue(),
				"grams",
			);
			assert.deepEqual(applicationErrors(errors), []);
		} finally {
			await context.close();
		}
	});
}
for (const width of [390, 1280]) verifyUnits(width);

function verifyChaffle(width) {
	it(`the chaffle renders every ingredient in all modes and serving sizes at ${width}px`, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			serviceWorkers: "block",
			reducedMotion: "reduce",
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(
				`${site.origin}/recipes/source-basic-keto-chaffle-recipe/?units=grams&servings=4`,
			);
			await ready(page);
			const flow = page.locator(
				width < 761
					? ".recipe-detail .mobile-flow"
					: ".recipe-detail .trn-table",
			);
			const quantities = flow.locator(
				width < 761 ? ".mobile-ingredient strong" : "th.trn-ingredient strong",
			);
			const units = page.getByRole("combobox", { name: UNIT_CONTROL });
			const servings = page.getByRole("combobox", { name: SERVINGS });
			assert.deepEqual(await quantities.allTextContents(), [
				"100 g",
				"75 g",
				"16 g",
				"1.3 g",
			]);
			await units.selectOption("metric");
			assert.deepEqual(await quantities.allTextContents(), [
				"100 g",
				"75 g",
				"16 g",
				"1.3 g",
			]);
			await units.selectOption("us");
			assert.deepEqual(await quantities.allTextContents(), [
				"2 count",
				"2.66 oz",
				"⅙ cup",
				"⅓ tsp",
			]);
			await units.selectOption("grams");
			await servings.selectOption("2");
			assert.deepEqual(await quantities.allTextContents(), [
				"50 g",
				"38 g",
				"8 g",
				"0.67 g",
			]);
			await servings.selectOption("8");
			assert.deepEqual(await quantities.allTextContents(), [
				"200 g",
				"151 g",
				"32 g",
				"2.7 g",
			]);
			await servings.selectOption("4");
			if (process.env.UI_EVIDENCE_DIR) {
				await mkdir(process.env.UI_EVIDENCE_DIR, { recursive: true });
				await flow.screenshot({
					path: `${process.env.UI_EVIDENCE_DIR}/chaffle-${width}-light.png`,
				});
				await page.emulateMedia({ colorScheme: "dark" });
				await flow.screenshot({
					path: `${process.env.UI_EVIDENCE_DIR}/chaffle-${width}-dark.png`,
				});
			}
			await page.emulateMedia({ media: "print" });
			assert.deepEqual(
				await page
					.locator(".print-document th.trn-ingredient strong")
					.allTextContents(),
				["100 g", "75 g", "16 g", "1.3 g"],
			);
			assert.deepEqual(applicationErrors(errors), []);
		} finally {
			await context.close();
		}
	});
}
for (const width of [390, 1280]) verifyChaffle(width);

it("individual recipe controls recover corrupt preferences and remain enabled when storage is denied", async () => {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = collectErrors(page, { warnings: true });
	try {
		await page.goto(`${site.origin}/recipes/lemon-salmon-and-asparagus/`);
		await ready(page);
		await page.evaluate(() =>
			localStorage.setItem("recipes-settings-v1", "{broken"),
		);
		await page.reload();
		await ready(page);
		await page
			.getByRole("combobox", { name: UNIT_CONTROL })
			.selectOption("grams");
		assert.deepEqual(
			await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			),
			{ units: "grams" },
		);
		await page.reload();
		await ready(page);
		assert.equal(
			await page.getByRole("combobox", { name: UNIT_CONTROL }).inputValue(),
			"grams",
		);
		assert.deepEqual(errors, [
			"Recipe units could not be restored; using US imperial. SyntaxError",
			"Malformed recipe settings were discarded while saving units. SyntaxError",
		]);
		await context.addInitScript(() => {
			Object.defineProperty(window, "localStorage", {
				get() {
					throw new DOMException("denied", "SecurityError");
				},
			});
		});
		await page.goto(`${site.origin}/recipes/lemon-salmon-and-asparagus/`);
		await ready(page);
		assert.equal(
			await page.getByRole("combobox", { name: SERVINGS }).isEnabled(),
			true,
		);
		await page
			.getByRole("combobox", { name: UNIT_CONTROL })
			.selectOption("metric");
		assert.equal(
			await page.getByRole("combobox", { name: UNIT_CONTROL }).inputValue(),
			"metric",
		);
		assert.deepEqual(errors.slice(2), [
			"Recipe units could not be restored; using US imperial. SecurityError",
			"Recipe units could not be saved; changes apply only to this visit. SecurityError",
		]);
	} finally {
		await context.close();
	}
});

// USDA broth 174536 is 249 g/cup; white wine 174837 is 29.4 g/fl oz.
// Water uses the reviewed 1 g/mL cooking convention and NIST 236.5882365 mL/cup.
const LIQUID_CHOICES = ["chicken broth", "Water", "White wine"];
const LIQUID_GRAMS = [249 / 4, 236.5882365 / 4, 29.4 * 2];
const LIQUID_DISPLAYS = {
	2: { grams: ["31 g", "30 g", "29 g"], metric: "30 mL", us: "⅛ cup" },
	4: { grams: ["62 g", "59 g", "59 g"], metric: "59 mL", us: "¼ cup" },
	6: { grams: ["93 g", "89 g", "88 g"], metric: "89 mL", us: "⅜ cup" },
	8: { grams: ["125 g", "118 g", "118 g"], metric: "118 mL", us: "½ cup" },
};

// biome-ignore-start lint/performance/noAwaitInLoops: each selection and download verifies the same live recipe state before changing it.
function verifyAlternatives(width) {
	it(`liquid alternatives survive screen, print and downloads in every mode and serving size at ${width}px`, {
		timeout: 120_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			serviceWorkers: "block",
			reducedMotion: "reduce",
			acceptDownloads: true,
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(
				`${site.origin}/recipes/source-keto-asian-chicken-lettuce-wraps/?units=grams&servings=4`,
			);
			await ready(page);
			const row = page
				.locator(
					width < 761
						? ".recipe-detail .mobile-ingredient"
						: ".recipe-detail th.trn-ingredient",
				)
				.filter({ hasText: "chicken broth" });
			const units = page.getByRole("combobox", { name: UNIT_CONTROL });
			const servings = page.getByRole("combobox", { name: SERVINGS });
			for (const count of [2, 4, 6, 8]) {
				// A fresh document resets Chromium's repeated-download limiter.
				await page.reload();
				await ready(page);
				await servings.selectOption(String(count));
				for (const mode of ["grams", "metric", "us"]) {
					await units.selectOption(mode);
					const quantities =
						mode === "grams"
							? LIQUID_DISPLAYS[count].grams
							: new Array(3).fill(LIQUID_DISPLAYS[count][mode]);
					assert.equal(await row.isVisible(), true);
					assert.deepEqual(
						await row.locator(".recipe-enhanced strong").allTextContents(),
						quantities,
					);
					assert.deepEqual(
						await row
							.locator(".recipe-enhanced .ingredient-name")
							.allTextContents(),
						LIQUID_CHOICES,
					);
					await page.emulateMedia({ media: "print" });
					const printed = page
						.locator(".print-document th.trn-ingredient")
						.filter({ hasText: "chicken broth" });
					assert.equal(await printed.isVisible(), true);
					assert.deepEqual(
						await printed.locator(".recipe-enhanced strong").allTextContents(),
						quantities,
					);
					assert.deepEqual(
						await printed
							.locator(".recipe-enhanced .ingredient-name")
							.allTextContents(),
						LIQUID_CHOICES,
					);
					await page.emulateMedia({ media: "screen" });
					const jsonDownload = page.waitForEvent("download");
					await page
						.getByRole("button", { name: "Download JSON", exact: true })
						.click();
					const bundle = JSON.parse(
						await readFile(await (await jsonDownload).path(), "utf8"),
					);
					assert.equal(bundle.settings.units, mode);
					assert.equal(bundle.settings.servings, count);
					const document = bundle.recipes[0];
					const ingredient = document.ingredients.find(
						(item) => item.name === LIQUID_CHOICES[0],
					);
					const choices = [ingredient, ...ingredient.alternatives];
					assert.deepEqual(
						choices.map((choice) => choice.name),
						LIQUID_CHOICES,
					);
					assert.deepEqual(
						choices.map((choice) => choice.quantity),
						quantities,
					);
					for (const [index, choice] of choices.entries())
						assert.ok(
							Math.abs(choice.grams - (LIQUID_GRAMS[index] * count) / 4) < 1e-9,
						);
					const cell = document.cookingFlow.rows
						.flat()
						.find(
							(item) =>
								item.kind === "ingredient" && item.name === LIQUID_CHOICES[0],
						);
					assert.deepEqual(
						cell.alternatives.map((choice) => choice.name),
						LIQUID_CHOICES.slice(1),
					);
					assert.deepEqual(
						[cell.text, ...cell.alternatives.map((choice) => choice.quantity)],
						quantities,
					);
					const markdownDownload = page.waitForEvent("download");
					await page
						.getByRole("button", { name: "Download Markdown", exact: true })
						.click();
					const markdown = await readFile(
						await (await markdownDownload).path(),
						"utf8",
					);
					assert.ok(
						markdown.includes(
							`- ${quantities[0]} chicken broth or ${quantities[1]} Water or ${quantities[2]} White wine`,
						),
					);
					assert.ok(
						markdown.includes(
							`<strong>${quantities[0]}</strong> chicken broth or <strong>${quantities[1]}</strong> Water or <strong>${quantities[2]}</strong> White wine`,
						),
					);
				}
			}
			assert.deepEqual(applicationErrors(errors), []);
		} finally {
			await context.close();
		}
	});
}
// biome-ignore-end lint/performance/noAwaitInLoops: ordered browser state verification.
for (const width of [390, 1280]) verifyAlternatives(width);
