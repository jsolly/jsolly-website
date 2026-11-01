import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";
import { legacyUnits } from "./recipe-legacy-units.mjs";

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

const SERVINGS = /^Servings/u;
function preferenceCase(path, override = true) {
	it(`preference-dependent content stays hidden until settings resolve at ${path}, URL override ${override}`, async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		let release;
		const scriptsReady = new Promise((resolve) => {
			release = resolve;
		});
		await context.addInitScript(() => {
			localStorage.setItem(
				"recipes-settings-v1",
				JSON.stringify({
					units: "metric",
					servings: 8,
					filters: { vegetarianOnly: true },
				}),
			);
		});
		await page.route("**/*.js", async (route) => {
			await scriptsReady;
			await route.continue();
		});
		try {
			await page.goto(
				`${site.origin}${path}${override ? `?${new URLSearchParams({ units: "grams", servings: "2" })}` : ""}`,
				{
					waitUntil: "commit",
				},
			);
			const pending = page.locator('[data-preferences-ready="false"]');
			await pending.waitFor({ state: "attached" });
			await page.waitForFunction(
				() =>
					getComputedStyle(document.querySelector("[data-preferences-ready]"))
						.visibility === "hidden",
			);
			assert.equal(await pending.count(), 1);
			assert.equal(await pending.isVisible(), false);
			assert.equal(
				await page.getByRole("combobox", { name: "Ingredient units" }).count(),
				0,
			);
			release();
			await page.locator('[data-preferences-ready="true"]').waitFor();
			assert.equal(await legacyUnits(page), override ? "grams" : "metric");
			assert.equal(
				await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
				override ? "2" : "8",
			);
			if (!override) {
				// biome-ignore lint/nursery/noConditionalExpect: only the saved-only library case owns dietary filters.
				assert.equal(
					await page
						.getByRole("checkbox", { name: "Vegetarian", exact: true })
						.isChecked(),
					true,
				);
			}
			assert.deepEqual(errors, []);
		} finally {
			release();
			await context.close();
		}
	});
}

preferenceCase("/recipes/");
preferenceCase("/recipes/source-sausage-broccoli-cheddar-sheet-pan/");
preferenceCase("/recipes/", false);
