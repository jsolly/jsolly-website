import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { PRINT_FAILED } from "../../src/components/recipes/constants.mjs";

import { cookText } from "../../src/components/recipes/display-units.mjs";
import nutritionData from "../../src/components/recipes/nutrition-data.json" with {
	type: "json",
};
import recipeData from "../../src/components/recipes/recipe-data.server.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";

const PRINT_ONLY_COPY =
	/Before you start|Where your attention goes|First-cook checks|These recipes include household adaptations/u;
const OMITTED_PREPARATION = /^Check\b.*°[FC]|^For larger servings,/iu;

// A built recipe page (/recipes/<id>/) in Chromium, with and without
// JavaScript. The server render is the no-JavaScript page: native checkboxes,
// a <details> vitamins disclosure and a plain share link. Hydrated, the
// RecipePage island swaps in the shadcn-svelte controls and reads the share
// link's ?servings= and ?starch=.
const DIST = "dist";
// A recipe with family sides, so the side select and ?starch= apply.
const RECIPE = "greek-turkey-patties";
const PAGE = `/recipes/${RECIPE}/`;
const SIDE = "bun_one";
// The page checks run on each kind of recipe page.
const KINDS = [
	{ kind: "a meal with family sides", id: RECIPE, familySides: true },
	{
		kind: "a meal without family sides",
		id: "lemon-salmon-and-asparagus",
		familySides: false,
	},
	{ kind: "a smoothie", id: "strawberry-banana-smoothie", familySides: false },
];
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const NATIVE_CHECKBOX = 'input[type="checkbox"]';
const VITAMINS = /Vitamins & minerals/u;
const SERVINGS = /^Servings/u;
const FAMILY_SIDE = /^Add a side/u;
const SPACES = /\s+/gu;
const LEARN_MORE = "Learn more about Tabular Recipe Notation";
const MISSING_TOTAL = /Not provided ready in/u;
const KNOWN_TOTAL = /80 min ready in/u;
const RANCH = recipeData.recipes.find(
	(recipe) => recipe.id === "source-keto-slow-cooker-zesty-ranch-chicken",
);

for (const width of [390, 1280]) {
	it(`publisher recipes show concise nutrition help, keep absent times and print known times at ${width}px`, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(
				`${site.origin}/recipes/source-honey-mustard-chicken-sheet-pan-dinner-keto-low-carb/`,
			);
			await page.getByRole("button", { name: "Print recipe" }).waitFor();
			assert.match(
				await page.locator(".detail-facts").textContent(),
				MISSING_TOTAL,
			);
			assert.match(
				await page.locator(".print-document .detail-facts").textContent(),
				MISSING_TOTAL,
			);
			assert.equal(
				await page.locator(".source-credit a").getAttribute("href"),
				"https://farmlifediy.com/honey-mustard-chicken-sheet-pan-dinner-keto-low-carb/",
			);
			await page.goto(
				`${site.origin}/recipes/source-keto-slow-cooker-zesty-ranch-chicken/`,
			);
			await page.getByRole("button", { name: "Print recipe" }).waitFor();
			assert.equal(
				await page
					.locator(".nutrition > dl > div")
					.filter({ has: page.locator("dt", { hasText: "Net carbs" }) })
					.locator("dd")
					.textContent(),
				`${RANCH.nutrition.net_carbs_g.toFixed(0)} g`,
			);
			assert.equal(
				await page.locator(".recipe-body .nutrition-assumptions").count(),
				0,
			);
			assert.equal(
				await page
					.locator(
						'.recipe-body [aria-label="Source notes"], .recipe-body [aria-label="Recipe method"]',
					)
					.count(),
				0,
			);
			const help = page.getByRole("button", { name: "What are net carbs?" });
			await help.focus();
			await help.press("Enter");
			await page
				.getByText("Total carbohydrates minus fiber and recorded erythritol.", {
					exact: false,
				})
				.first()
				.waitFor();
			await help.press("Escape");
			await page.goto(`${site.origin}/recipes/source-perfect-roast-chicken/`);
			await page.getByRole("button", { name: "Print recipe" }).waitFor();
			assert.match(
				await page.locator(".detail-facts").textContent(),
				KNOWN_TOTAL,
			);
			assert.match(
				await page.locator(".print-document .detail-facts").textContent(),
				KNOWN_TOTAL,
			);
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("8");
			assert.equal(
				await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
				"8",
			);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}

let site;
let browser;

before(async () => {
	site = await serveStatic(DIST);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

it("mobile flow preserves ordered operations, allocation leaves and cooking checks across resize", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	const errors = collectErrors(page, { warnings: true });
	try {
		for (const id of [
			"source-15-minute-broccoli-chicken-in-cream-cheese-sundried-tomato-sauce",
			"lemon-salmon-and-asparagus",
			"strawberry-banana-smoothie",
		]) {
			const recipe = recipeData.recipes.find(
				(candidate) => candidate.id === id,
			);
			const actions = [];
			const leaves = [];
			function walk(node) {
				if (node.children) {
					node.children.forEach(walk);
					actions.push(cookText(node.action, "us").trim());
				} else leaves.push(node.ingredientId);
			}
			walk(recipe.flow.root);
			// biome-ignore lint/performance/noAwaitInLoops: One page exercises these recipes sequentially.
			await page.goto(`${site.origin}/recipes/${id}/`);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			const mobile = page.locator(".recipe-body .mobile-flow");
			assert.equal(await mobile.isVisible(), true);
			assert.deepEqual(
				(await mobile.locator(".branch-join p").allTextContents()).map(
					(content) => content.trim(),
				),
				actions,
			);
			assert.equal(
				await mobile.locator(".mobile-ingredient").count(),
				leaves.length,
			);
			assert.deepEqual(
				await mobile.locator(".ingredient-name").allTextContents(),
				leaves.map(
					(ingredientId) =>
						recipe.ingredients.find((item) => item.id === ingredientId).name,
				),
			);
			const preparation = await mobile.locator(".mobile-prep").textContent();
			for (const note of recipe.flow.prep) {
				const omitted = OMITTED_PREPARATION.test(note);
				assert.equal(preparation.includes(cookText(note, "us")), !omitted);
			}

			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth,
				),
				false,
			);
			await mobile.getByRole("checkbox").first().check();
			await page.setViewportSize({ width: 1280, height: 900 });
			const desktop = page.locator(".recipe-body .trn-frame");
			assert.equal(
				await desktop.getByRole("checkbox").first().isChecked(),
				true,
			);
			assert.deepEqual(
				await mobile.locator(".mobile-ingredient strong").allTextContents(),
				await desktop.locator("th.trn-ingredient strong").allTextContents(),
			);
			await desktop
				.getByRole("button", { name: "Reset cooking checks" })
				.click();
			await page.setViewportSize({ width: 390, height: 844 });
			assert.equal(
				await mobile.getByRole("checkbox").first().isChecked(),
				false,
			);
		}
		await page.goto(
			`${site.origin}/recipes/lemon-salmon-and-asparagus/?servings=8`,
		);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(
			await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
			"8",
		);
		const scaledMobile = page.locator(".recipe-body .mobile-flow");
		// US display of canonical eight-serving allocations: oil, garlic and salt each have two branches.
		assert.deepEqual(
			await scaledMobile.locator(".mobile-ingredient strong").allTextContents(),
			[
				"3 lb",
				"0.95 oz",
				"1 tsp",
				"½ tsp",
				"¼ tsp",
				"0.14 oz",
				"2 lb",
				"0.95 oz",
				"1 tsp",
				"½ tsp",
				"2.12 oz",
				"1.41 oz",
			],
		);
		assert.deepEqual(
			await scaledMobile.locator(".mobile-ingredient strong").allTextContents(),
			await page
				.locator(".recipe-body .trn-frame th.trn-ingredient strong")
				.allTextContents(),
		);
		await page.emulateMedia({ media: "print" });
		assert.equal(
			await page.locator(".print-document .trn-frame").isVisible(),
			true,
		);
		assert.equal(
			await page.locator(".print-document .mobile-flow").isVisible(),
			false,
		);
		await page.emulateMedia({ media: "screen" });
		const plain = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width: 390, height: 844 },
		});
		try {
			const native = await plain.newPage();
			await native.goto(`${site.origin}/recipes/lemon-salmon-and-asparagus/`);
			const checkbox = native
				.locator(".recipe-body .mobile-flow")
				.locator(NATIVE_CHECKBOX)
				.first();
			await checkbox.check();
			assert.equal(await checkbox.isChecked(), true);
			assert.equal(
				await native
					.getByRole("button", { name: "What are net carbs?" })
					.count(),
				0,
			);
			assert.equal(
				await native
					.getByText("Total carbohydrates minus fiber.", { exact: true })
					.isVisible(),
				true,
			);
		} finally {
			await plain.close();
		}
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

// An init script for a browser that can neither share nor copy.
function blockSharing() {
	Object.defineProperty(Navigator.prototype, "share", {
		value: undefined,
		configurable: true,
	});
	Object.defineProperty(Navigator.prototype, "clipboard", {
		value: {
			writeText: () =>
				Promise.reject(
					new DOMException("clipboard blocked", "NotAllowedError"),
				),
		},
		configurable: true,
	});
}

const text = async (locator) =>
	(await locator.textContent()).replace(SPACES, " ").trim();

// Opens path in a fresh context and waits for the recipe island to hydrate.
// Resolves to { page, errors, close }.
async function openHydrated(path, { initScript } = {}) {
	// Reduced motion turns the blog's colour transitions off, so a computed
	// colour is the settled one.
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		reducedMotion: "reduce",
	});
	if (initScript) await context.addInitScript(initScript);
	const page = await context.newPage();
	const errors = collectErrors(page);
	await page.goto(`${site.origin}${path}`);
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	await page.getByRole("button", { name: "Print recipe" }).waitFor();
	return { page, errors, close: () => context.close() };
}

// Registers the no-JavaScript and hydrated page checks for one recipe page.
function pageChecks({ kind, id, familySides }) {
	it(`without JavaScript the page for ${kind} offers native checkboxes, a vitamins details disclosure and a share link, with one shared cooking document`, async () => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto(`${site.origin}/recipes/${id}/`);
			const detail = page.locator(".recipe-detail");
			assert.deepEqual(
				await detail.locator(".family-box select").evaluateAll((selects) =>
					selects.map((select) => ({
						value: select.value,
						first: select.options[0].textContent,
					})),
				),
				familySides ? [{ value: "", first: "None" }] : [],
			);
			assert.equal(
				await detail.locator(".family-box p, .side-nutrition").count(),
				0,
			);
			const firstCheck = detail.locator(`${NATIVE_CHECKBOX}:visible`).first();
			await detail.locator("th.trn-ingredient label:visible").first().click();
			const disclosure = detail.locator("details.nutrient-disclosure");
			await disclosure.locator("summary").click();
			assert.deepEqual(
				{
					nativeChecks: (await detail.locator(NATIVE_CHECKBOX).count()) > 0,
					labelTicksBox: await firstCheck.isChecked(),
					shadcnChecks: await detail
						.locator("[data-slot=checkbox]:visible")
						.count(),
					detailsOpen: await disclosure.evaluate((element) => element.open),
					familySelect:
						(await detail.locator(".family-box select").count()) > 0,
					shareLink: await detail
						.getByRole("link", { name: "Share recipe link" })
						.getAttribute("href"),
					shareIcon: await detail
						.getByRole("link", { name: "Share recipe link" })
						.locator("svg")
						.isVisible(),
					shareButton: await detail
						.getByRole("button", { name: "Share this recipe" })
						.count(),
					printCopyShown: await page.locator(".print-document").isVisible(),
					methodLink: await detail
						.locator("a.learn-method")
						.getAttribute("href"),
				},
				{
					nativeChecks: true,
					labelTicksBox: true,
					shadcnChecks: 0,
					detailsOpen: true,
					familySelect: familySides,
					shareLink: `/recipes/${id}/`,
					shareIcon: true,
					shareButton: 0,
					printCopyShown: true,
					methodLink: "https://www.cookingforengineers.com/",
				},
			);
		} finally {
			await context.close();
		}
	});

	it(`a reader on the hydrated page for ${kind} opens the vitamins disclosure, ticks ingredients by box and by label, and Reset clears every tick`, async () => {
		const { page, errors, close } = await openHydrated(`/recipes/${id}/`);
		try {
			const detail = page.locator(".recipe-detail");
			const trigger = detail.getByRole("button", { name: VITAMINS });
			await trigger.click();
			const checks = detail.getByRole("checkbox");
			const first = checks.nth(0);
			const second = checks.nth(1);
			await first.click();
			// The label's ingredient text, not the box, takes the second click.
			await detail
				.locator("th.trn-ingredient label:visible")
				.nth(1)
				.locator("strong")
				.click();
			const background = (box) =>
				box.evaluate((element) => getComputedStyle(element).backgroundColor);
			const ticked = {
				disclosureOpen: await trigger.getAttribute("aria-expanded"),
				vitaminsShown: await detail
					.locator(".nutrient-disclosure dl")
					.isVisible(),
				first: await first.getAttribute("aria-checked"),
				second: await second.getAttribute("aria-checked"),
				struckRows: await detail.locator("th.trn-ingredient.checked").count(),
				nativeChecks: await detail.locator(NATIVE_CHECKBOX).count(),
				familySelect: (await detail.locator(".family-box select").count()) > 0,
			};
			const tickedLooksDifferent =
				(await background(first)) !== (await background(checks.nth(2)));
			await detail
				.getByRole("button", { name: "Reset cooking checks" })
				.click();
			assert.deepEqual(
				{
					...ticked,
					tickedLooksDifferent,
					afterReset: await detail.locator("th.trn-ingredient.checked").count(),
					errors,
				},
				{
					disclosureOpen: "true",
					vitaminsShown: true,
					first: "true",
					second: "true",
					struckRows: 2,
					nativeChecks: 0,
					familySelect: familySides,
					tickedLooksDifferent: true,
					afterReset: 0,
					errors: [],
				},
			);
		} finally {
			await close();
		}
	});
}

for (const recipe of KINDS) pageChecks(recipe);

it("Learn more opens the notation dialog with focus on it; Escape closes it and returns focus to Learn more, and so does its close button", async () => {
	const { page, errors, close } = await openHydrated(PAGE);
	try {
		await page.setViewportSize({ width: 320, height: 812 });
		const learnMore = page.getByRole("button", { name: LEARN_MORE });
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
			true,
			"The narrow recipe page must keep the long notation control inside the viewport",
		);
		const dialog = page.getByRole("dialog", {
			name: "Tabular Recipe Notation",
		});
		const focusOnLearnMore = () =>
			learnMore.evaluate((element) => document.activeElement === element);
		await learnMore.click();
		await dialog.waitFor();
		await page.waitForFunction(() =>
			document.activeElement?.closest("[role=dialog]"),
		);
		const focusOnDialog = await dialog.evaluate(
			(element) => document.activeElement === element,
		);
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "detached" });
		const afterEscape = await focusOnLearnMore();
		await learnMore.click();
		await dialog
			.getByRole("button", { name: "Close and continue recipe" })
			.click();
		await dialog.waitFor({ state: "detached" });
		assert.deepEqual(
			{
				focusOnDialog,
				afterEscape,
				afterClose: await focusOnLearnMore(),
				errors,
			},
			{ focusOnDialog: true, afterEscape: true, afterClose: true, errors: [] },
		);
	} finally {
		await close();
	}
});

it("Print recipe prints only the recipe copy and restores the page once printing ends", async () => {
	const { page, errors, close } = await openHydrated(PAGE, {
		initScript: () => {
			window.__prints = 0;
			window.print = () => {
				window.__prints += 1;
			};
		},
	});
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole("button", { name: "Toggle mobile menu" }).click();
		assert.equal(await page.locator("#mobile-menu").isVisible(), true);
		await page.getByRole("button", { name: "Print recipe" }).click();
		await page.emulateMedia({ media: "print" });
		const printing = {
			prints: await page.evaluate(() => window.__prints),
			mode: await page.evaluate(() =>
				document.documentElement.getAttribute("data-recipe-print"),
			),
			copyShown: await page.locator(".print-document").isVisible(),
			printControls: await page
				.locator(
					".print-document button:visible:not(.nutrient-trigger):not(.nutrition-info)",
				)
				.count(),
			paperChecks: await page
				.locator(".print-document .trn-ingredient")
				.evaluateAll(
					(rows) =>
						rows.length > 0 &&
						rows.every((row) => {
							const box = row.querySelector(".paper-check");
							return (
								box?.checkVisibility() &&
								getComputedStyle(box).borderTopStyle === "solid" &&
								box.getBoundingClientRect().width > 0
							);
						}),
				),
			pageHidden: await page.locator(".recipe-detail").isHidden(),
			breadcrumbsHidden: await page.locator(".breadcrumbs").isHidden(),
			headerHidden: await page.locator("#site-header").isHidden(),
			mobileNavigationHidden: await page.locator("#mobile-menu").isHidden(),
			footerHidden: await page.locator(".site-footer").isHidden(),
		};
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await page.emulateMedia({ media: "screen" });
		assert.deepEqual(
			{
				...printing,
				modeAfter: await page.evaluate(() =>
					document.documentElement.getAttribute("data-recipe-print"),
				),
				headerRestored: await page.locator("#site-header").isVisible(),
				mobileNavigationRestored: await page
					.locator("#mobile-menu")
					.isVisible(),
				pageRestored: await page.locator(".recipe-detail").isVisible(),
				errors,
			},
			{
				prints: 1,
				mode: "recipe",
				copyShown: true,
				printControls: 0,
				paperChecks: true,
				pageHidden: false,
				breadcrumbsHidden: true,
				headerHidden: true,
				mobileNavigationHidden: true,
				footerHidden: true,
				modeAfter: null,
				headerRestored: true,
				mobileNavigationRestored: true,
				pageRestored: true,
				errors: [],
			},
		);
	} finally {
		await close();
	}
});

it("when the browser cannot open printing, Print recipe says so and leaves the page as it was", async () => {
	const { page, errors, close } = await openHydrated(PAGE, {
		initScript: () => {
			window.print = () => {
				throw new Error("printing blocked");
			};
		},
	});
	try {
		await page.getByRole("button", { name: "Print recipe" }).click();
		const status = page.locator(".recipe-detail > p[role=status]");
		await status.filter({ hasText: PRINT_FAILED }).waitFor();
		assert.deepEqual(
			{
				status: await status.textContent(),
				mode: await page.evaluate(() =>
					document.documentElement.getAttribute("data-recipe-print"),
				),
				errors: errors.map((error) => error.split("\n")[0]),
			},
			{
				status: PRINT_FAILED,
				mode: null,
				errors: ["Recipe printing failed: Error: printing blocked"],
			},
		);
	} finally {
		await close();
	}
});

it("a reader who picks 8 servings and the bun side gets the scaled recipe and a share link with both", async () => {
	const { page, errors, close } = await openHydrated(PAGE, {
		initScript: blockSharing,
	});
	try {
		const detail = page.locator(".recipe-detail");
		const sideSelect = detail.getByRole("combobox", { name: FAMILY_SIDE });
		assert.equal(await sideSelect.inputValue(), "");
		assert.equal(
			await detail.locator(".family-box p, .side-nutrition").count(),
			0,
		);
		await detail.getByRole("combobox", { name: SERVINGS }).selectOption("8");
		const baseBeforeSide = await detail
			.locator(".nutrition > dl dd")
			.allTextContents();
		await detail
			.getByRole("combobox", { name: FAMILY_SIDE })
			.selectOption(SIDE);
		const selected = recipeData.recipes
			.find((recipe) => recipe.id === RECIPE)
			.familyOptions.find((option) => option.id === SIDE);
		const sideRow = nutritionData.familyOptions[RECIPE].find(
			(row) => row.ingredientId === SIDE,
		);
		const sideFat = (sideRow.nutrients.fat * sideRow.grams) / 100;
		assert.equal(
			await text(detail.locator(".side-nutrition")),
			`Side only, per person: ${selected.nutrition.kcal.toFixed(0)} kcal · Protein ${selected.nutrition.protein_g.toFixed(0)} g · Fat ${sideFat.toFixed(0)} g · Carbs ${selected.nutrition.carbs_g.toFixed(0)} g · Fiber ${selected.nutrition.fiber_g.toFixed(0)} g · Net carbs ${selected.nutrition.net_carbs_g.toFixed(0)} g. Base nutrition below excludes this side.`,
		);
		assert.deepEqual(
			await detail.locator(".nutrition > dl dd").allTextContents(),
			baseBeforeSide,
		);
		const share = page.locator(".recipe-share");
		await share.getByRole("button", { name: "Share this recipe" }).click();
		await share.getByRole("link").waitFor();
		assert.deepEqual(
			{
				facts: await text(detail.locator(".detail-facts")),
				sideLine: await text(detail.locator(".family-box p")),
				cucumber: await text(
					detail.locator("th.trn-ingredient strong").first(),
				),
				link: await share.getByRole("link").getAttribute("href"),
				errors,
			},
			{
				facts:
					"15 min active time / base batch 8 servings 40 min / base batch ready in",
				sideLine: "12.7 oz Bun · serve separately",
				cucumber: "1.32 lb",
				link: `${site.origin}${PAGE}?servings=8&units=us&starch=greek-turkey-patties%3Abun_one`,
				errors: [],
			},
		);
		await page.emulateMedia({ media: "print" });
		assert.equal(await detail.locator(".family-box").isVisible(), true);
		assert.equal(await detail.locator(".side-nutrition").isVisible(), false);
		await page.emulateMedia({ media: "screen" });
		await sideSelect.selectOption("");
		assert.equal(await sideSelect.inputValue(), "");
		assert.equal(
			await detail.locator(".family-box p, .side-nutrition").count(),
			0,
		);
		assert.deepEqual(
			await detail.locator(".nutrition > dl dd").allTextContents(),
			baseBeforeSide,
		);
		await page.emulateMedia({ media: "print" });
		assert.equal(await detail.locator(".family-box").isVisible(), false);
		await page.emulateMedia({ media: "screen" });
	} finally {
		await close();
	}
});

it("a shared link with ?servings=6 and a family side opens the recipe at six servings with that side", async () => {
	const { page, errors, close } = await openHydrated(
		`${PAGE}?servings=6&starch=${RECIPE}:${SIDE}`,
	);
	try {
		const detail = page.locator(".recipe-detail");
		assert.deepEqual(
			{
				servings: await detail
					.getByRole("combobox", { name: SERVINGS })
					.inputValue(),
				side: await detail
					.getByRole("combobox", { name: FAMILY_SIDE })
					.inputValue(),
				facts: await text(detail.locator(".detail-facts")),
				sideLine: await text(detail.locator(".family-box p")),
				errors,
			},
			{
				servings: "6",
				side: SIDE,
				facts:
					"15 min active time / base batch 6 servings 40 min / base batch ready in",
				sideLine: "9.52 oz Bun · serve separately",
				errors: [],
			},
		);
	} finally {
		await close();
	}
});

it("where the browser can neither share nor copy, Share recipe announces and shows the link to copy", async () => {
	const { page, errors, close } = await openHydrated(PAGE, {
		initScript: blockSharing,
	});
	try {
		const share = page.locator(".recipe-share");
		const status = share.getByRole("status");
		const statusBefore = await status.count();
		await share.getByRole("button", { name: "Share this recipe" }).click();
		await status.filter({ hasText: "Copy this recipe link:" }).waitFor();
		assert.deepEqual(
			{
				statusBefore,
				link: await share.getByRole("link").getAttribute("href"),
				errors,
			},
			{
				statusBefore: 1,
				link: `${site.origin}${PAGE}?servings=4&units=us`,
				errors: [],
			},
		);
	} finally {
		await close();
	}
});

function recipeShareFailureCheck({ failure, result, diagnostic }) {
	it(`recipe sharing handles ${failure} with a truthful outcome and error signal`, async () => {
		const { page, errors, close } = await openHydrated(PAGE);
		try {
			await page.evaluate((scenario) => {
				window.__copyCalls = 0;
				Object.defineProperty(navigator, "share", {
					value: ["cancel", "share-permission", "share-unexpected"].includes(
						scenario,
					)
						? () => {
								if (scenario === "cancel")
									return Promise.reject(
										new DOMException("Cancelled", "AbortError"),
									);
								if (scenario === "share-permission")
									return Promise.reject(
										new DOMException("Share denied", "NotAllowedError"),
									);
								return Promise.reject(new Error("Share service failed"));
							}
						: undefined,
					configurable: true,
				});
				Object.defineProperty(navigator, "clipboard", {
					value:
						scenario === "unavailable"
							? undefined
							: {
									writeText: () => {
										window.__copyCalls += 1;
										if (scenario === "copy-permission")
											return Promise.reject(
												new DOMException("Copy denied", "NotAllowedError"),
											);
										if (scenario === "copy-unexpected")
											return Promise.reject(
												new Error("Clipboard service failed"),
											);
										return Promise.resolve();
									},
								},
					configurable: true,
				});
			}, failure);
			const share = page.locator(".recipe-share");
			await share.getByRole("button", { name: "Share this recipe" }).click();
			if (result)
				await share.getByRole("status").filter({ hasText: result }).waitFor();
			const status = await share.getByRole("status").textContent();
			const manualLink = result === "Copy this recipe link:";
			assert.equal(
				manualLink
					? status
							.replace(`${site.origin}${PAGE}?servings=4&units=us`, "")
							.trim()
					: status,
				result,
			);
			assert.equal(
				await page.evaluate(() => window.__copyCalls),
				["cancel", "unavailable"].includes(failure) ? 0 : 1,
			);
			assert.deepEqual(
				await share
					.getByRole("link")
					.evaluateAll((links) => links.map((link) => link.href)),
				manualLink ? [`${site.origin}${PAGE}?servings=4&units=us`] : [],
			);
			const expectedDiagnostic =
				failure === "share-unexpected"
					? `Sharing recipe ${PAGE.split("/")[2]} failed. Error: Share service failed`
					: `Copying recipe ${PAGE.split("/")[2]} link failed. Error: Clipboard service failed`;
			assert.deepEqual(
				errors.map((error) => error.split("\n")[0]),
				diagnostic ? [expectedDiagnostic] : [],
			);
		} finally {
			await close();
		}
	});
}

for (const scenario of [
	{ failure: "cancel", result: "", diagnostic: null },
	{
		failure: "share-permission",
		result: "Recipe link copied.",
		diagnostic: null,
	},
	{
		failure: "share-unexpected",
		result: "Recipe link copied.",
		diagnostic: "Sharing recipe",
	},
	{
		failure: "copy-permission",
		result: "Copy this recipe link:",
		diagnostic: null,
	},
	{
		failure: "copy-unexpected",
		result: "Copy this recipe link:",
		diagnostic: "Copying recipe",
	},
	{
		failure: "unavailable",
		result: "Copy this recipe link:",
		diagnostic: null,
	},
])
	recipeShareFailureCheck(scenario);

// Compare exact cooking strings, excluding controls and responsive duplicates.
const cookingCopy = (root) =>
	root.evaluate((rootElement) => {
		const content = rootElement.cloneNode(true);
		for (const fallback of content.querySelectorAll("noscript"))
			fallback.remove();
		const fields = [
			".badge",
			"h1",
			".nutrition-pills",
			".detail-summary",
			".source-credit",
			".detail-facts",
			".family-box p",
			".trn-prep",
			".trn-table .ingredient-name",
			".trn-table .trn-ingredient strong",
			".trn-table .trn-ingredient small",
			".trn-operation",
			".nutrition > h2, .nutrition > h3",
			".nutrition-portion",
			".nutrition > dl",
			".nutrient-disclosure small",
		];
		return fields.map((selector) =>
			Array.from(
				content.querySelectorAll(selector),
				(element) => element.textContent,
			),
		);
	});

// biome-ignore-start lint/performance/noAwaitInLoops: ordered browser navigation in isolated viewport contexts.
it("screen, page printing and card packets use identical cooking copy", {
	timeout: 120_000,
}, async () => {
	for (const width of [390, 1280]) {
		const context = await browser.newContext({
			viewport: { width, height: 984 },
			reducedMotion: "reduce",
			serviceWorkers: "block",
		});
		await context.addInitScript(() => {
			window.print = () => {
				/* Stub the native print dialog; assertions inspect print media. */
			};
		});
		const page = await context.newPage();
		try {
			for (const id of [
				"lemon-salmon-and-asparagus",
				RECIPE,
				"strawberry-banana-smoothie",
			]) {
				await page.goto(
					`${site.origin}/recipes/${id}/?servings=6&units=metric`,
				);
				await page.waitForFunction(
					() => !document.querySelector("astro-island[ssr]"),
				);
				const content = page.locator(".recipe-content");
				await content.getByRole("button", { name: VITAMINS }).click();
				await content
					.locator(".nutrient-content")
					.waitFor({ state: "visible" });
				const expected = await cookingCopy(content);
				await content.evaluate((element) => {
					window.screenRecipe = element;
					window.screenRecipeText = element.textContent;
				});
				await page
					.getByRole("button", { name: "Print recipe", exact: true })
					.click();
				await page.emulateMedia({ media: "print" });
				assert.equal(
					await page
						.locator(".print-document .recipe-content")
						.evaluate(
							(element) =>
								element === window.screenRecipe &&
								element.textContent === window.screenRecipeText,
						),
					true,
				);
				assert.deepEqual(
					await cookingCopy(page.locator(".print-document .recipe-content")),
					expected,
				);
				assert.equal(await page.locator(".print-output").count(), 0);
				assert.equal(
					await content.locator(".nutrient-content").isVisible(),
					false,
				);
				assert.equal(await content.locator(".nutrition").isVisible(), false);
				assert.equal(
					await content.locator(".nutrition-pills").isVisible(),
					false,
				);
				await page.evaluate(() =>
					window.dispatchEvent(new Event("afterprint")),
				);
				await page.emulateMedia({ media: "screen" });
				assert.equal(
					await content.locator(".nutrient-content").isVisible(),
					true,
				);
				await page.goto(
					`${site.origin}/recipes/${id.includes("smoothie") ? "smoothies" : "meals"}/`,
				);
				await page.waitForFunction(
					() => !document.querySelector("astro-island[ssr]"),
				);
				await page
					.getByRole("combobox", { name: "Servings", exact: true })
					.selectOption("6");
				await page
					.getByRole("combobox", { name: "Ingredient units" })
					.selectOption("metric");
				await page
					.getByRole("searchbox", { name: "Search recipes" })
					.fill(recipeData.recipes.find((recipe) => recipe.id === id).title);
				const card = page
					.locator(".recipe-card")
					.filter({ has: page.locator(`[data-recipe-id="${id}"]`) });
				await card
					.getByRole("button", { name: "Print recipe", exact: true })
					.click();
				const packet = page.locator(".print-output .recipe-content");
				await packet.waitFor({ state: "attached" });
				await page.emulateMedia({ media: "print" });
				assert.equal(await packet.locator(".nutrition").isVisible(), false);
				assert.equal(
					await packet.locator(".nutrition-pills").isVisible(),
					false,
				);
				assert.deepEqual(await cookingCopy(packet), expected);
				assert.doesNotMatch(await packet.textContent(), PRINT_ONLY_COPY);
				await page.evaluate(() =>
					window.dispatchEvent(new Event("afterprint")),
				);
				await page.emulateMedia({ media: "screen" });
			}
		} finally {
			await context.close();
		}
	}
});

// biome-ignore-end lint/performance/noAwaitInLoops: ordered browser navigation.
