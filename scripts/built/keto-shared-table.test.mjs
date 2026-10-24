// biome-ignore-all lint/performance/noAwaitInLoops: Review each real recipe document and browser setting in order.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import data from "../../src/components/recipes/recipe-data.server.mjs";
import { collectErrors, readBuilt, serveStatic } from "./pages.mjs";

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

it("every published cooking page and canonical download carries its shared-table guidance", async () => {
	const bundle = JSON.parse(
		await readFile("dist/recipes/data/recipe-library.json", "utf8"),
	);
	assert.equal(bundle.recipes.length, 140);
	for (const recipe of data.recipes) {
		const exported = bundle.recipes.find(
			({ recipeId }) => recipeId === recipe.id,
		);
		assert.equal(exported.dietaryClassification, "keto", recipe.id);
		assert.equal(exported.sharedTable, recipe.sharedTable, recipe.id);
		assert.ok(exported.nutrition.net_carbs_g <= 12.5, recipe.id);
		const visible = await readBuilt(
			`recipes/${recipe.id}`,
			(document) => document.querySelector(".shared-table p")?.textContent,
		);
		assert.equal(
			visible,
			recipe.sharedTable,
			`${recipe.id}: static cooking page`,
		);
		const markdown = await readFile(`dist/recipes/${recipe.id}.md`, "utf8");
		assert.ok(markdown.includes(recipe.sharedTable), `${recipe.id}: Markdown`);
	}
});

function verifySharedTable(width) {
	it(`a side for two survives reload, sharing and print beside a four-person meal at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			serviceWorkers: "block",
		});
		await context.addInitScript(() => {
			Object.defineProperty(navigator, "share", {
				configurable: true,
				value: ({ url }) => {
					globalThis.sharedRecipeURL = url;
					return Promise.resolve();
				},
			});
		});
		const page = await context.newPage();
		const errors = collectErrors(page);
		const ready = () =>
			page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
		const side = () =>
			page.getByRole("combobox", { name: "Add a side", exact: true });
		const sideDiners = () =>
			page.getByRole("combobox", {
				name: "People having this side",
				exact: true,
			});
		try {
			await page.goto(`${site.origin}/recipes/greek-turkey-patties/`);
			await ready();
			const baseMacros = await page.locator(".nutrition > dl").textContent();
			await page
				.getByRole("combobox", { name: "Ingredient units" })
				.selectOption("grams");
			await side().selectOption("pita_one");
			await sideDiners().selectOption("2");
			await page.reload();
			await ready();
			assert.equal(await side().inputValue(), "pita_one");
			assert.equal(await sideDiners().inputValue(), "2");
			assert.equal(
				await page
					.getByRole("combobox", { name: "Servings", exact: true })
					.inputValue(),
				"4",
			);
			assert.ok(
				(await page.locator(".family-box p").textContent()).includes(
					"120 g Pita",
				),
			);
			assert.equal(
				await page.locator(".nutrition > dl").textContent(),
				baseMacros,
			);
			await page.getByRole("button", { name: "Share this recipe" }).click();
			const shared = new URL(
				await page.evaluate(() => globalThis.sharedRecipeURL),
			);
			assert.equal(shared.searchParams.get("sideDiners"), "2");
			assert.equal(
				shared.searchParams.get("starch"),
				"greek-turkey-patties:pita_one",
			);
			await page.emulateMedia({ media: "print" });
			assert.equal(await page.locator(".shared-table").isVisible(), true);
			assert.ok(
				(await page.locator(".family-box p").textContent()).includes(
					"for 2 people",
				),
			);
			await page.emulateMedia({ media: "screen" });
			if (process.env.UI_EVIDENCE_DIR) {
				await mkdir(process.env.UI_EVIDENCE_DIR, { recursive: true });
				for (const colorScheme of ["light", "dark"]) {
					await page.emulateMedia({ colorScheme });
					await page.screenshot({
						path: `${process.env.UI_EVIDENCE_DIR}/keto-shared-table-${width}-${colorScheme}.png`,
						fullPage: true,
					});
				}
			}
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
				true,
			);
			await side().selectOption("");
			await page.getByRole("button", { name: "Share this recipe" }).click();
			const none = await page.evaluate(() => globalThis.sharedRecipeURL);
			await side().selectOption("pita_one");
			await page.goto(none);
			await ready();
			assert.equal(await side().inputValue(), "");
			assert.equal(
				await page
					.getByRole("combobox", { name: "People having this side" })
					.count(),
				0,
			);
			await page.goto(`${site.origin}/recipes/keto-fried-calamari/`);
			await ready();
			assert.ok(
				(await page.locator(".shared-table").textContent()).includes(
					"separate",
				),
			);
			assert.equal(
				await page
					.locator(".recipe-photo img")
					.evaluate((img) => img.complete && img.naturalWidth > 0),
				true,
			);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}

for (const width of [390, 1280]) verifySharedTable(width);
