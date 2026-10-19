// biome-ignore-all lint/performance/noAwaitInLoops: Each case navigates the same browser page sequentially.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import recipeData from "../../src/components/recipes/recipe-data.server.mjs";
import { collectErrors, serveStatic, stubOffOrigin } from "./pages.mjs";

const DOWNLOAD_BUTTON = /^Download (?:Markdown|JSON)$/u;

const CASES = [
	[
		"spinach-feta-and-hemp-frittata",
		"/recipes/",
		["Immune support", "Iron-rich", "High in Omega-3s"],
		["Keto"],
	],
	[
		"tomato-lentil-and-chicken-bake",
		"/recipes/",
		["Immune support", "Iron-rich"],
		["Not keto"],
	],
	["pesto-cod-and-zucchini", "/recipes/", ["High in Omega-3s"], ["Keto"]],
	[
		"strawberry-hemp-smoothie",
		"/recipes/smoothies/",
		["High in Omega-3s"],
		["Keto"],
	],
	["avocado-lime-smoothie", "/recipes/smoothies/", [], ["Keto"]],
];
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
const hydrated = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
const pills = (root) => root.locator(".nutrition-pills li").allTextContents();

async function uniformPillText(page, root) {
	for (const colorScheme of ["light", "dark"]) {
		await page.emulateMedia({ colorScheme });
		const colors = await root
			.locator(".nutrition-pills li")
			.evaluateAll((items) =>
				items.map((item) => getComputedStyle(item).color),
			);
		// biome-ignore lint/suspicious/noMisplacedAssertion: Shared browser assertion called from the tests below.
		assert.ok(
			new Set(colors).size <= 1,
			`${colorScheme} pills share one text color`,
		);
	}
	await page.emulateMedia({ colorScheme: "light" });
}

function registerPillTest(width) {
	it(`Nutrition pills match recipe eligibility across cards, dialogs and pages (${width}px)`, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			serviceWorkers: "block",
		});
		await stubOffOrigin(context, site.origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		try {
			for (const [id, collection, expected, group] of CASES) {
				await page.goto(`${site.origin}${collection}`);
				await hydrated(page);
				await page
					.getByRole("searchbox", { name: "Search recipes" })
					.fill(recipeData.recipes.find((recipe) => recipe.id === id).title);
				const card = page.locator(
					`.recipe-card:has(a[data-recipe-id="${id}"])`,
				);
				await card.waitFor();
				assert.deepEqual(
					await pills(card),
					[...group, ...expected],
					`${id} card`,
				);
				assert.equal(await card.locator(".card-top").count(), 0);
				await uniformPillText(page, card);
				await page.goto(`${site.origin}${collection}#${id}`);
				await hydrated(page);
				const dialog = page.getByRole("dialog");
				await dialog.waitFor();
				assert.deepEqual(await pills(dialog), expected, `${id} dialog`);
				await uniformPillText(page, dialog);
				assert.equal(
					await dialog
						.getByRole("button", { name: "Print recipe", exact: true })
						.count(),
					1,
				);
				assert.equal(
					await dialog.getByRole("button", { name: DOWNLOAD_BUTTON }).count(),
					0,
				);
				await page.goto(`${site.origin}/recipes/${id}/`);
				await hydrated(page);
				assert.deepEqual(
					await pills(page.locator(".recipe-detail")),
					expected,
					`${id} page`,
				);
				await uniformPillText(page, page.locator(".recipe-detail"));
				assert.equal(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
					true,
				);
			}
			await page.goto(`${site.origin}/recipes/`);
			await hydrated(page);
			await page
				.getByRole("searchbox", { name: "Search recipes" })
				.fill("perfect roast chicken");
			const roastCard = page.locator(
				'.recipe-card:has(a[data-recipe-id="source-perfect-roast-chicken"])',
			);
			await page
				.getByRole("combobox", { name: "Servings", exact: true })
				.selectOption("2");
			await roastCard
				.locator(".nutrition-pills")
				.getByText("Iron-rich", { exact: true })
				.waitFor();
			await page
				.getByRole("combobox", { name: "Servings", exact: true })
				.selectOption("8");
			await roastCard
				.locator(".nutrition-pills")
				.getByText("Iron-rich", { exact: true })
				.waitFor({ state: "detached" });
			// This recipe's fixed minimum broth changes per-serving iron at small batches.
			await page.goto(
				`${site.origin}/recipes/source-perfect-roast-chicken/?servings=2`,
			);
			await hydrated(page);
			const detail = page.locator(".recipe-detail");
			await detail
				.locator(".nutrition-pills")
				.getByText("Iron-rich", { exact: true })
				.waitFor();
			await page
				.getByRole("combobox", { name: "Servings", exact: true })
				.selectOption("8");
			await detail
				.locator(".nutrition-pills")
				.getByText("Iron-rich", { exact: true })
				.waitFor({ state: "detached" });
			assert.deepEqual(await pills(detail), ["Immune support"]);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}
for (const width of [390, 1280]) registerPillTest(width);
