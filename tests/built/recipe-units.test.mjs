import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { defaultAppliances } from "../../src/components/recipes/constants.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";
import { legacyUnits, setLegacyUnits } from "./recipe-legacy-units.mjs";

const DOWNLOAD_BUTTON = /^Download (?:Markdown|JSON)$/u;

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
const WEIGHING = /A pinch/u;
const PARTIAL_GRAMS = /\d+\.\d+ g\b/u;
const TWO_EGGS = /^2 large eggs\b/u;
// biome-ignore-start lint/suspicious/noMisplacedAssertion: Called by the measured-ingredient browser scenarios.
function assertMeasures(actual, expected) {
	assert.equal(actual.length, expected.length);
	for (const [index, amount] of expected.entries()) {
		assert.ok(
			actual[index].split(" / ").includes(amount),
			`${actual[index]} includes ${amount}`,
		);
		assert.ok(actual[index].split(" / ").length <= 3);
		assert.doesNotMatch(actual[index], PARTIAL_GRAMS);
	}
}
// biome-ignore-end lint/suspicious/noMisplacedAssertion: shared browser assertions.
const ready = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
function verifyUnits(width) {
	it(`simultaneous measures survive legacy unit preferences, links, redirect and print at ${width}px`, {
		timeout: 90_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			reducedMotion: "reduce",
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		const prior = {
			servings: 8,
			units: "us",
			familyDiners: 8,
			filters: {
				proteinChoice: ["fish"],
				ingredientChoice: ["hemp"],
				vegetarianOnly: false,
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
			assert.equal(
				await page.getByRole("combobox", { name: UNIT_CONTROL }).count(),
				0,
			);
			await setLegacyUnits(page, "grams");
			assert.equal(await legacyUnits(page), "grams");
			assert.equal(new URL(page.url()).searchParams.get("units"), "grams");
			await page.reload();
			await ready(page);
			assert.equal(await legacyUnits(page), "grams");
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
			const flow = page.locator(".recipe-detail .trn-table");
			assert.match(await flow.textContent(), GRAMS);
			assert.match(await flow.textContent(), WEIGHING);
			const afterUnits = await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			);
			assert.deepEqual(afterUnits, {
				...prior,
				servings: 2,
				units: "grams",
				familyDiners: 2,
			});
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
			assert.equal(
				await page
					.getByRole("button", { name: "Print recipe", exact: true })
					.count(),
				1,
			);
			assert.equal(
				await page.getByRole("button", { name: DOWNLOAD_BUTTON }).count(),
				0,
			);

			await page.emulateMedia({ media: "print" });
			assert.match(
				await page.locator(".print-document .trn-table").textContent(),
				GRAMS,
			);
			await page.emulateMedia({ media: "screen" });
			await setLegacyUnits(page, "metric");
			assert.match(await flow.textContent(), GRAMS);
			await setLegacyUnits(page, "us");
			assert.match(await flow.textContent(), IMPERIAL);
			await setLegacyUnits(page, "grams");
			// Standalone controls now persist servings as well as units. Restore
			// eight before checking the same large batch after the legacy redirect.
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("8");
			await page.goto(`${site.origin}/recipes/meals/`);
			await ready(page);
			assert.equal(await legacyUnits(page), "grams");
			const restored = await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			);
			assert.deepEqual(restored.filters.proteinChoice, ["fish"]);
			assert.deepEqual(restored.filters.ingredientChoice, ["hemp"]);
			assert.deepEqual(restored.familyChoice, prior.familyChoice);
			assert.equal(restored.servings, 8);
			assert.equal(restored.familyDiners, 2);
			const href = await page
				.locator('[data-recipe-id="lemon-salmon-and-asparagus"]')
				.getAttribute("href");
			assert.equal(
				new URL(href, site.origin).searchParams.get("units"),
				"grams",
			);
			// A legacy library link redirects to the page with the link's units
			// and the saved servings, where the units can still be switched.
			await page.goto(
				`${site.origin}/recipes/?units=metric#lemon-salmon-and-asparagus`,
				{ waitUntil: "commit" },
			);
			await page.waitForURL(
				(url) => url.pathname === "/recipes/lemon-salmon-and-asparagus/",
			);
			await ready(page);
			const redirected = new URL(page.url()).searchParams;
			assert.deepEqual(
				{
					servings: redirected.get("servings"),
					units: redirected.get("units"),
					shown: await legacyUnits(page),
				},
				{ servings: "8", units: "metric", shown: "metric" },
			);
			await setLegacyUnits(page, "grams");
			assert.match(await flow.textContent(), LARGE_GRAMS);
			await page.goto(`${site.origin}/recipes/meals/`);
			await ready(page);
			assert.equal(await legacyUnits(page), "grams");
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
			const servings = page.getByRole("combobox", { name: SERVINGS });
			const base = await quantities.allTextContents();
			assertMeasures(base, ["100 g", "75 g", "16 g", "1 g"]);
			assert.match(base[0], TWO_EGGS);
			assert.equal(
				await page.getByRole("combobox", { name: UNIT_CONTROL }).count(),
				0,
			);
			for (const mode of ["metric", "us", "grams"]) {
				// biome-ignore lint/performance/noAwaitInLoops: each legacy URL is opened and verified before the next.
				await setLegacyUnits(page, mode);
				assert.deepEqual(await quantities.allTextContents(), base);
			}
			await servings.selectOption("2");
			assertMeasures(await quantities.allTextContents(), [
				"50 g",
				"38 g",
				"8 g",
				"A pinch",
			]);
			await servings.selectOption("8");
			assertMeasures(await quantities.allTextContents(), [
				"200 g",
				"151 g",
				"32 g",
				"3 g",
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
			assertMeasures(
				await page
					.locator(".print-document th.trn-ingredient strong")
					.allTextContents(),
				["100 g", "75 g", "16 g", "1 g"],
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
		assert.equal(
			await page.getByRole("combobox", { name: UNIT_CONTROL }).count(),
			0,
		);
		await page.getByRole("combobox", { name: SERVINGS }).selectOption("6");
		assert.deepEqual(
			await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			),
			{ units: "us", servings: 6, familyDiners: 0, familyChoice: {} },
		);
		await page.reload();
		await ready(page);
		assert.equal(
			await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
			"6",
		);
		assert.deepEqual(
			await page.evaluate(() =>
				JSON.parse(localStorage.getItem("recipes-settings-v1")),
			),
			{ units: "us", servings: 6, familyDiners: 0, familyChoice: {} },
		);
		assert.deepEqual(errors, [
			"Recipe preferences could not be restored; using US imperial and no side. SyntaxError",
			"Malformed recipe settings were discarded while saving preferences. SyntaxError",
		]);
		const errorsBeforeDeniedStorage = errors.length;
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
		await page.getByRole("combobox", { name: SERVINGS }).selectOption("6");
		assert.equal(
			await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
			"6",
		);
		await page
			.getByText("Preferences apply to this visit but could not be saved.", {
				exact: true,
			})
			.waitFor();
		// A made mark the browser refuses to save stays for this visit, even
		// when returning to the tab re-reads the (denied) record.
		const made = page.getByRole("checkbox", { name: "I made this" });
		await made.check();
		await page
			.getByText(
				"Your made mark applies to this visit but could not be saved.",
				{
					exact: true,
				},
			)
			.waitFor();
		await page.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		// The made failure has its own line, so the preferences warning stays.
		assert.deepEqual(
			{
				checked: await made.isChecked(),
				made: await page.locator(".made [role=status]").textContent(),
				shared: await page
					.locator(".recipe-detail > p[role=status]")
					.textContent(),
			},
			{
				checked: true,
				made: "Your made mark applies to this visit but could not be saved.",
				shared: "Preferences apply to this visit but could not be saved.",
			},
		);
		assert.deepEqual(errors.slice(errorsBeforeDeniedStorage), [
			"Recipe preferences could not be restored; using US imperial and no side. SecurityError",
			"Made recipes could not be restored; showing none as made. SecurityError",
			"Recipe preferences could not be saved; changes apply only to this visit. SecurityError",
			"A made recipe could not be saved; the mark applies only to this visit. SecurityError",
		]);
	} finally {
		await context.close();
	}
});

// USDA broth 174536 is 249 g/cup; white wine 174837 is 29.4 g/fl oz.
// Water uses the reviewed 1 g/mL cooking convention and NIST 236.5882365 mL/cup.
const LIQUID_CHOICES = ["chicken broth", "or Water", "or White wine"];
const LIQUID_DISPLAYS = {
	2: { grams: ["31 g", "30 g", "29 g"], metric: "30 mL", us: "⅛ cup" },
	4: { grams: ["62 g", "59 g", "59 g"], metric: "59 mL", us: "¼ cup" },
	6: { grams: ["93 g", "89 g", "88 g"], metric: "89 mL", us: "⅜ cup" },
	8: { grams: ["125 g", "118 g", "118 g"], metric: "118 mL", us: "½ cup" },
};

// biome-ignore-start lint/performance/noAwaitInLoops: each selection verifies the same live recipe state before changing it.
function verifyAlternatives(width) {
	it(`liquid alternatives survive screen and print in every mode and serving size at ${width}px`, {
		timeout: 120_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			serviceWorkers: "block",
			reducedMotion: "reduce",
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
			const servings = page.getByRole("combobox", { name: SERVINGS });
			for (const count of [2, 4, 6, 8]) {
				await page.reload();
				await ready(page);
				await servings.selectOption(String(count));
				for (const mode of count === 4
					? ["grams", "metric", "us"]
					: ["grams"]) {
					await setLegacyUnits(page, mode);
					const quantities = LIQUID_DISPLAYS[count].grams;
					assert.equal(await row.isVisible(), true);
					assertMeasures(
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
					assertMeasures(
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
