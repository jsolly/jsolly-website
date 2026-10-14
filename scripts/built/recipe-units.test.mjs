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
const UNIT_CONTROL = "Ingredient units";
const SERVINGS = /^Servings/u;
const GRAMS = /340 g/u;
const IMPERIAL = /11.99 oz/u;
const LARGE_GRAMS = /1360 g/u;
const WEIGHING = /~0.78 g/u;
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

			await page.emulateMedia({ media: "print" });
			assert.match(
				await page.locator(".print-document .ingredient-list").textContent(),
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
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}
for (const width of [390, 1280]) verifyUnits(width);

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
