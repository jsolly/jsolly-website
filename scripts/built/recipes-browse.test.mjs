import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";
import { assertPrintImage } from "./recipe-print-image.mjs";

// Browsing the built recipe library in Chromium, ported from awesome-blog's
// PWA suite (scripts/recipes/pwa.test.mjs) without its service worker: a meal
// and a smoothie page with and without JavaScript, share links, the Easy Meals
// filters and their saved settings (J13: localStorage recipes-settings-v1),
// and the meals and smoothies pages without JavaScript plus the nutrition
// help popover. Each runs at a phone and a desktop width.
const DIST = "dist";
const LANDING = "/recipes/";
// Literal on purpose: the key is J13's decision, not whatever constants.mjs says.
const STORAGE_KEY = "recipes-settings-v1";
const RECIPES = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const { recipes } = JSON.parse(await readFile(RECIPES, "utf8"));
const meals = recipes.filter((recipe) => recipe.type === "meal");
const smoothieCount = recipes.filter(
	(recipe) => recipe.type === "smoothie",
).length;
const WIDTHS = [390, 1280];
const HEIGHT = 900;
// A wrapping label names a select after its text and its current option.
const SERVINGS = /^Servings/u;
const FAMILY_SIDE = /^Add a side/u;
const VITAMINS = /^Vitamins & minerals/u;
const PROTEINS = /^Proteins:/u;
const CARBS = /^Carbs:/u;
const INGREDIENTS = /^Ingredients:/u;
const SPACES = /\s+/gu;
const PITA_SIDE = /1.06 lb Pita/u;
const EIGHT_SERVINGS_CHICKEN = /3 lb/u;
const RICE_SIDE = /5.64 oz Cooked rice/u;
const TWO_SERVINGS_CHICKEN = /11.99 oz/u;
const SMOOTHIE_YIELD = /up to two servings/u;
const GLASS_NUTRITION = /Nutrition\s*per estimated 8 fl oz \(237 mL\) glass/u;
const EIGHT_SERVINGS_WATER = /27.05 fl oz Cold water/u;
const EIGHT_SERVINGS = /8\s+servings/u;
// Longer than the help popover's 120ms close delay.
const HELP_CLOSE_WAIT_MS = 400;
const COOKING_FLOW = /Cooking flow/u;
const REMOVED_PRINT_SECTIONS =
	/Before you start|Where your attention goes|First-cook checks/u;
// This exact diagnostic comes from Playwright, not the application.
const WORKER_BLOCK_NOTICE = "Service Worker registration blocked by Playwright";
const LEARN_MORE = "Learn more about Tabular Recipe Notation";
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const NATIVE_CHECKBOX = "input[type=checkbox]:visible";
const SHARED = "/recipes/shawarma-chicken-bowls/";

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

const hydrated = (page) => page.locator("[data-hydrated=true]").waitFor();
const recipeReady = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
const stored = (page) =>
	page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

// Follows a link that loads another page, then waits for its library.
async function follow(page, link, url) {
	await Promise.all([page.waitForURL(url), link.click()]);
	await hydrated(page);
}

// What a recipe body shows; the live and no-JavaScript pages must agree on it.
async function bodyContent(body, width) {
	return {
		appliances: await body.locator(".detail-appliances").textContent(),
		facts: await body.locator(".detail-facts").textContent(),
		image: await body.locator(".recipe-photo img").getAttribute("src"),
		flow: await body
			.locator(
				width <= 760
					? ".mobile-prep p, .mobile-ingredient label:visible, .branch-join p"
					: ".trn-table tr:not(.reset-checks-row)",
			)
			.allInnerTexts(),
		macros: await body.locator(".nutrition>dl dd").allTextContents(),
		nutrients: await body.locator(".daily-values:visible").allInnerTexts(),
		family: await body.locator(".family-box p").allTextContents(),
	};
}

const normalize = (value) =>
	JSON.stringify(value, (_key, item) =>
		typeof item === "string" ? item.replace(SPACES, " ").trim() : item,
	);

// Recipes are content, not code: a meal and a smoothie prove the hydrated page
// matches the page without JavaScript. recipes-built.test.mjs checks representative
// static bodies and every recipe image without a browser.
function detailParityCheck(recipe, width) {
	it(`${recipe.id} matches without JavaScript at ${width}px`, {
		timeout: 30_000,
	}, async () => {
		const viewport = { width, height: HEIGHT };
		const plain = await browser.newContext({
			serviceWorkers: "block",
			javaScriptEnabled: false,
			viewport,
			reducedMotion: "reduce",
		});
		const context = await browser.newContext({
			serviceWorkers: "block",
			viewport,
			reducedMotion: "reduce",
		});
		try {
			const page = await context.newPage();
			const errors = collectErrors(page, { warnings: true });
			const staticPage = await plain.newPage();
			await Promise.all([
				page.goto(`${site.origin}/recipes/${recipe.id}/`),
				staticPage.goto(`${site.origin}/recipes/${recipe.id}/`),
			]);
			const live = page.locator(".recipe-detail .recipe-body");
			try {
				await recipeReady(page);
			} catch (error) {
				const state = await page.evaluate(() => {
					const row = document.querySelector(
						".recipe-detail .reset-checks-row",
					);
					return {
						rowPresent: Boolean(row),
						rowDisplay: row ? getComputedStyle(row).display : null,
						pendingIslands: [
							...document.querySelectorAll("astro-island[ssr]"),
						].map((island) => island.getAttribute("component-url")),
					};
				});
				throw new Error(
					`Recipe ${recipe.id} did not expose cooking checks at ${page.url()}; state: ${JSON.stringify(state)}; browser errors: ${JSON.stringify(errors)}`,
					{ cause: error },
				);
			}
			await live.getByRole("button", { name: VITAMINS }).click();
			const staticBody = staticPage.locator(`#${recipe.id} .recipe-body`);
			await staticBody.locator("summary").filter({ hasText: VITAMINS }).click();
			assert.equal(
				normalize(await bodyContent(live, width)),
				normalize(await bodyContent(staticBody, width)),
				recipe.id,
			);
			assert.deepEqual(
				errors.filter((message) => message !== WORKER_BLOCK_NOTICE),
				[],
			);
		} finally {
			await context.close();
			await plain.close();
		}
	});
}

function detailsCheck(width) {
	it(`Recipe cards and share links keep their settings at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const viewport = { width, height: HEIGHT };
		const plain = await browser.newContext({
			serviceWorkers: "block",
			javaScriptEnabled: false,
			viewport,
			reducedMotion: "reduce",
		});
		const context = await browser.newContext({
			serviceWorkers: "block",
			viewport,
			reducedMotion: "reduce",
		});
		await context.addInitScript(() => {
			Object.defineProperty(navigator, "share", {
				configurable: true,
				value: (data) => {
					window.sharedRecipe = data;
					return Promise.resolve();
				},
			});
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: (text) => {
						window.copiedRecipe = text;
						return Promise.resolve();
					},
				},
			});
			window.print = () => {
				window.dispatchEvent(new Event("beforeprint"));
			};
		});
		const staticPage = await plain.newPage();
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await staticPage.goto(`${site.origin}${LANDING}`);
			assert.equal(await staticPage.locator(".recipe-card").count(), 6);
			assert.equal(
				await staticPage
					.getByRole("navigation", { name: "Breadcrumb" })
					.count(),
				0,
			);
			assert.equal(await staticPage.locator(".recipe-detail").count(), 0);
			await page.goto(`${site.origin}${LANDING}`);
			await hydrated(page);
			const cardFacts = () =>
				page.locator(".recipe-card .card-numbers").allTextContents();
			const initialFacts = await cardFacts();
			for (const count of ["2", "6", "8", "4"]) {
				// biome-ignore lint/performance/noAwaitInLoops: exercise successive settings on the same page.
				await page
					.getByRole("combobox", { name: SERVINGS })
					.selectOption(count);
				assert.deepEqual(
					await cardFacts(),
					initialFacts,
					`Card facts stay per serving at ${count} servings`,
				);
			}
			assert.equal(
				await page.getByText("Net carbs per serving", { exact: true }).count(),
				await page.locator(".recipe-card").count(),
			);
			assert.equal(
				await page.locator(".time-number").filter({ hasText: "+" }).count(),
				0,
			);
			assert.equal(
				await page.getByText("Prep time (publisher)", { exact: true }).count(),
				0,
			);
			await page.goto(
				`${site.origin}${SHARED}?servings=8&starch=shawarma-chicken-bowls:pita_one`,
			);
			const share = page.getByRole("button", {
				name: "Share this recipe",
				exact: true,
			});
			await share.click();
			const shared = new URL(
				await page.evaluate(() => window.sharedRecipe.url),
			);
			assert.deepEqual(
				{
					path: shared.pathname,
					hash: shared.hash,
					servings: shared.searchParams.get("servings"),
					starch: shared.searchParams.get("starch"),
				},
				{
					path: SHARED,
					hash: "",
					servings: "8",
					starch: "shawarma-chicken-bowls:pita_one",
				},
			);
			const receiver = await browser.newContext({
				serviceWorkers: "block",
				viewport,
			});
			try {
				const received = await receiver.newPage();
				await received.goto(shared.href);
				await recipeReady(received);
				assert.match(
					await received.locator(".family-box p").textContent(),
					PITA_SIDE,
				);
				assert.match(
					await received
						.locator(".recipe-detail .trn-ingredient")
						.filter({ hasText: "chicken thighs" })
						.textContent(),
					EIGHT_SERVINGS_CHICKEN,
				);
			} finally {
				await receiver.close();
			}
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
			await page
				.getByRole("combobox", { name: FAMILY_SIDE })
				.selectOption("rice_half_cup");
			await share.click();
			const changed = new URL(
				await page.evaluate(() => window.sharedRecipe.url),
			);
			const fresh = await browser.newContext({
				serviceWorkers: "block",
				viewport,
			});
			try {
				const reopened = await fresh.newPage();
				await reopened.goto(changed.href);
				await recipeReady(reopened);
				assert.match(
					await reopened.locator(".family-box p").textContent(),
					RICE_SIDE,
				);
				assert.match(
					await reopened
						.locator(".recipe-detail .trn-ingredient")
						.filter({ hasText: "chicken thighs" })
						.textContent(),
					TWO_SERVINGS_CHICKEN,
				);
			} finally {
				await fresh.close();
			}
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("8");
			await page
				.getByRole("combobox", { name: FAMILY_SIDE })
				.selectOption("pita_one");
			await page.evaluate(() =>
				Object.defineProperty(navigator, "share", { value: undefined }),
			);
			await share.click();
			await page.getByText("Recipe link copied.", { exact: true }).waitFor();
			assert.equal(await page.evaluate(() => window.copiedRecipe), shared.href);
			await page.evaluate(() =>
				Object.defineProperty(navigator, "clipboard", {
					value: {
						writeText: () =>
							Promise.reject(
								new DOMException("Permission denied", "NotAllowedError"),
							),
					},
				}),
			);
			await share.click();
			assert.equal(
				await page.locator(".recipe-share a").getAttribute("href"),
				shared.href,
			);
			await page
				.getByRole("button", { name: "Print recipe", exact: true })
				.click();
			await page.emulateMedia({ media: "print" });
			assert.equal(await page.locator(".print-document").isVisible(), true);
			assert.equal(await page.locator(".recipe-detail").isVisible(), true);
			await assertPrintImage(page.locator(".print-document .recipe-photo img"));
			const printed = await page.locator(".print-document").textContent();
			assert.match(printed, COOKING_FLOW);
			assert.doesNotMatch(printed, REMOVED_PRINT_SECTIONS);
			const borders = await page
				.locator(".print-document .trn-table")
				.evaluate((table) => {
					const styles = getComputedStyle(table);
					return [
						styles.borderTopWidth,
						styles.borderRightWidth,
						styles.borderBottomWidth,
						styles.borderLeftWidth,
					];
				});
			assert.ok(
				borders.every((border) => Number.parseFloat(border) > 0),
				`printed flow table borders: ${borders.join(" ")}`,
			);
			assert.deepEqual(
				errors.filter((message) => message !== WORKER_BLOCK_NOTICE),
				[],
			);
		} finally {
			await context.close();
			await plain.close();
		}
	});
}

function filtersCheck(width) {
	it(`Easy Meals preserves filters and recipe navigation at ${width}px`, {
		timeout: 120_000,
	}, async () => {
		const context = await browser.newContext({
			serviceWorkers: "block",
			viewport: { width, height: 984 },
		});
		const page = await context.newPage();
		const errors = collectErrors(page);
		const checkbox = (name) =>
			page.getByRole("checkbox", { name, exact: true });
		const cards = async () => {
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			return page
				.locator("#meal-results")
				.getAttribute("data-match-count")
				.then(Number);
		};
		// Browse API/native pagination suites compare complete result sets. This UI
		// scenario checks control wiring, total count and every mounted card without
		// mounting the entire library again for each filter combination.
		const expectCards = async (expected) => {
			await page.waitForFunction((total) => {
				const results = document.querySelector("#meal-results");
				return (
					results.getAttribute("aria-busy") === "false" &&
					Number(results.getAttribute("data-match-count")) === total
				);
			}, expected.length);
			const shown = await page
				.locator(".recipe-card a.title-button")
				.evaluateAll((links) =>
					links.map((link) => link.dataset.recipeId).sort(),
				);
			assert.ok(shown.length >= Math.min(6, expected.length));
			assert.ok(shown.length <= expected.length);
			assert.deepEqual(
				shown,
				expected
					.slice(0, shown.length)
					.map((recipe) => recipe.id)
					.sort(),
			);
		};
		try {
			await page.goto(`${site.origin}${LANDING}`);
			await hydrated(page);
			assert.equal(await checkbox("Not keto").count(), 0);
			for (const [keto, vegetarian] of [
				[true, false],
				[false, true],
				[true, true],
				[false, false],
			]) {
				// biome-ignore lint/performance/noAwaitInLoops: exercise each independent filter combination in sequence
				await checkbox("Keto").setChecked(keto);
				await checkbox("Vegetarian").setChecked(vegetarian);
				const expected = meals.filter(
					(recipe) =>
						(!keto || recipe.nutrition.net_carbs_g <= 12.5) &&
						(!vegetarian || recipe.vegetarian === true),
				);
				await expectCards(expected);
				if (keto && !vegetarian) {
					// The second Keto batch differs from the unfiltered batch. Keep
					// this browser boundary: later requests must retain the filter.
					const expectedIds = expected.slice(0, 12).map(({ id }) => id);
					// biome-ignore lint/nursery/noConditionalExpect: this parameterized branch proves the Keto second page differs from an unfiltered page.
					assert.notDeepEqual(
						expectedIds,
						meals.slice(0, 12).map(({ id }) => id),
					);
					await page
						.getByRole("button", { name: "Load more recipes", exact: true })
						.scrollIntoViewIfNeeded();
					await page.waitForFunction(
						() => document.querySelectorAll(".recipe-card").length >= 12,
					);
					// biome-ignore lint/nursery/noConditionalExpect: the Keto scenario exercises filtered pagination at both viewports.
					assert.deepEqual(
						await page
							.locator(".recipe-card a.title-button")
							.evaluateAll((links) =>
								links.slice(0, 12).map((link) => link.dataset.recipeId),
							),
						expectedIds,
					);
					await page.evaluate(() => window.scrollTo(0, 0));
				}
			}
			await checkbox("Keto").check();
			await checkbox("Vegetarian").check();
			await page.reload();
			await hydrated(page);
			assert.equal(await checkbox("Keto").isChecked(), true);
			assert.equal(await checkbox("Vegetarian").isChecked(), true);
			await checkbox("Vegetarian").uncheck();
			await checkbox("Keto").uncheck();
			// Re-ticking Air fryers restores the complete matching meal count.
			await checkbox("Air fryers").uncheck();
			await expectCards(
				meals.filter(
					(recipe) => !recipe.appliancesNeeded.includes("Two air fryers"),
				),
			);
			await checkbox("Air fryers").check();
			await expectCards(meals);
			assert.equal(
				await page
					.getByRole("combobox", { name: "Air fryers count", exact: true })
					.inputValue(),
				"2",
			);
			await page.getByRole("button", { name: PROTEINS }).click();
			await checkbox("Fish").check();
			await checkbox("Turkey").check();
			await page.keyboard.press("Escape");
			// The closing protein panel retains its Clear button during its exit animation.
			await page
				.getByRole("dialog", { name: "Proteins choices", exact: true })
				.waitFor({ state: "detached" });
			assert.equal(await checkbox("Vegetarian").isDisabled(), true);
			await page.getByRole("button", { name: CARBS }).click();
			await page
				.getByRole("dialog", { name: "Carbs choices", exact: true })
				.waitFor({ state: "visible" });
			assert.equal(
				await page.getByRole("button", { name: "Clear selections" }).count(),
				0,
			);
			assert.equal(await checkbox("No starch").count(), 0);
			await checkbox("Bread").check();
			await page.keyboard.press("Escape");
			await checkbox("Pressure cookers").uncheck();
			await checkbox("Air fryers").uncheck();
			await checkbox("Oven").uncheck();
			await checkbox("Microwave").uncheck();
			// Imported meals may use a blender and pans with an explicit heat source.
			assert.equal(await checkbox("Blender").count(), 1);
			assert.equal(await checkbox("Pans").isDisabled(), false);
			for (const name of [
				"Blender",
				"Pans",
				"Stovetop",
				"Grill",
				"Slow cooker",
				"Waffle iron",
			]) {
				// biome-ignore lint/performance/noAwaitInLoops: each checkbox rerenders the appliance controls.
				await checkbox(name).uncheck();
			}
			assert.equal(await cards(), 0);
			// With no recipe left, a checked protein can still be unchecked.
			await page.getByRole("button", { name: PROTEINS }).click();
			assert.equal(await checkbox("Fish").isDisabled(), false);
			assert.equal(
				await page
					.getByRole("dialog")
					.getByRole("checkbox", { name: "Vegetarian", exact: true })
					.count(),
				0,
			);
			await page.keyboard.press("Escape");
			const saved = await stored(page);
			assert.deepEqual(saved.filters.proteinChoice, ["fish", "turkey"]);
			assert.deepEqual(saved.filters.starchChoice, ["bread"]);
			await page.reload();
			await hydrated(page);
			const reloaded = await stored(page);
			assert.deepEqual(reloaded.filters, saved.filters);
			assert.deepEqual(reloaded.appliancesOnHand, saved.appliancesOnHand);
			assert.equal(await checkbox("Pans").isDisabled(), false);
			assert.equal(await cards(), 0);
			await checkbox("Oven").check();
			await checkbox("Microwave").check();
			await checkbox("Blender").check();

			await follow(
				page,
				page.getByRole("link", { name: "Smoothies", exact: true }),
				"**/recipes/smoothies/",
			);
			assert.equal(await cards(), smoothieCount);
			assert.equal(
				await page.getByRole("button", { name: PROTEINS }).count(),
				0,
			);
			assert.equal(await page.getByRole("button", { name: CARBS }).count(), 0);
			// Smoothies keep their own keto filter; meal dietary checks are not offered.
			assert.equal(
				await page
					.getByRole("checkbox", {
						name: "Vegetarian",
						includeHidden: true,
					})
					.count(),
				0,
			);
			assert.equal(await page.locator(".inventory-options label").count(), 1);
			await page.getByRole("button", { name: INGREDIENTS }).click();
			await checkbox("Hulled hemp hearts").check();
			await page.keyboard.press("Escape");
			assert.equal(await cards(), 1);
			await page.reload();
			await hydrated(page);
			assert.deepEqual((await stored(page)).filters.ingredientChoice, ["hemp"]);
			assert.equal(await cards(), 1);
			await page.getByRole("button", { name: INGREDIENTS }).click();
			await page
				.getByRole("button", { name: "Clear selections", exact: true })
				.click();
			await page.keyboard.press("Escape");
			await checkbox("Keto Friendly").check();
			assert.equal(await cards(), 4);
			await page.reload();
			await hydrated(page);
			assert.equal(
				await page
					.getByRole("link", { name: "Smoothies", exact: true })
					.getAttribute("aria-current"),
				"page",
			);
			assert.equal((await stored(page)).filters.smoothieKetoOnly, true);
			assert.equal(await cards(), 4);
			const avocado = page.getByRole("link", {
				name: "Avocado-lime smoothie",
				exact: true,
			});
			await avocado.scrollIntoViewIfNeeded();
			await page.waitForFunction(() => {
				const image = document
					.querySelector('[data-recipe-id="avocado-lime-smoothie"]')
					.closest(".recipe-card")
					.querySelector("img");
				return image.complete && image.naturalWidth > 0;
			});
			await avocado.click();
			await page.waitForURL(`${site.origin}/recipes/avocado-lime-smoothie/`);
			await recipeReady(page);
			await page.getByRole("button", { name: LEARN_MORE, exact: true }).click();
			await page.locator(".method-dialog").waitFor();
			await page.keyboard.press("Escape");
			await page.locator(".method-dialog").waitFor({ state: "detached" });
			assert.equal(await page.locator(".recipe-detail").isVisible(), true);
			const smoothiesPage = (url) => url.pathname === "/recipes/smoothies/";
			await page
				.getByRole("link", { name: "← Back to smoothies", exact: true })
				.click();
			await page.waitForURL(smoothiesPage);
			await hydrated(page);
			assert.equal(await cards(), 4);
			await page.goForward();
			await page.waitForURL(`${site.origin}/recipes/avocado-lime-smoothie/`);
			await recipeReady(page);
			await page.goBack();
			await page.waitForURL(smoothiesPage);
			await hydrated(page);
			await page.evaluate(
				(key) =>
					localStorage.setItem(
						key,
						JSON.stringify({ filters: { ironRich: true }, servings: 8 }),
					),
				STORAGE_KEY,
			);
			// A legacy #<recipe-id> link replaces itself with the recipe page,
			// carrying the saved servings, before the library saves anything.
			await page.goto(
				`${site.origin}${LANDING}?deep-link=1#strawberry-banana-smoothie`,
				{ waitUntil: "commit" },
			);
			await page.waitForURL(
				`${site.origin}/recipes/strawberry-banana-smoothie/?servings=8&units=us`,
			);
			await recipeReady(page);
			assert.deepEqual(await stored(page), {
				filters: { ironRich: true },
				servings: 8,
			});
			const detail = page.locator(".recipe-detail");
			const opened = await detail.textContent();
			assert.match(opened, SMOOTHIE_YIELD);
			assert.match(opened, GLASS_NUTRITION);
			await page.getByRole("button", { name: VITAMINS }).click();
			assert.equal(
				await page
					.locator(".daily-values")
					.getByText("0% DV", { exact: true })
					.count(),
				0,
			);
			assert.equal(await detail.locator(".reset-checks-row").count(), 1);
			assert.match(
				await detail.locator(".trn-table").textContent(),
				EIGHT_SERVINGS_WATER,
			);
			await page
				.getByRole("link", { name: "← Back to smoothies", exact: true })
				.click();
			await page.waitForURL(smoothiesPage);
			await hydrated(page);
			assert.equal(await cards(), smoothieCount);
			assert.equal((await stored(page)).filters.ironRich, true);
			assert.equal(await checkbox("Iron-rich").count(), 0);
			assert.deepEqual(
				errors.filter((message) => message !== WORKER_BLOCK_NOTICE),
				[],
			);
		} finally {
			await context.close();
		}
	});
}

// The nutrition help with a mouse and from the keyboard. Hovering opens it
// and leaving closes it; a click while it is hover-opened keeps it open after
// the pointer leaves. Enter opens it with focus left on the trigger and Tab
// moves on (focus is not trapped). Escape closes it and moves focus only out
// of the help itself, back to the trigger, however the help was opened;
// focus on the trigger or past it stays put. Focus that moves on the moment
// it opens (a quick Tab, faster than Playwright can send one) must stay
// moved, so the page moves it when the help appears. Resolves to where focus
// was after each step.
async function pointerAndKeyboardHelp({ page, help, popover, heading }) {
	// The search row can put the title and help in different scroll positions.
	// Send continuous pointer travel after scrolling so the hover grace area
	// receives movement out of the trigger, rather than a single teleport.
	const moveToHeading = async () => {
		await heading.scrollIntoViewIfNeeded();
		const target = await heading.boundingBox();
		await page.mouse.move(
			target.x + target.width / 2,
			target.y + target.height / 2,
			{ steps: 10 },
		);
	};
	const focused = () =>
		page.evaluate(() => ({
			onHelp: document.activeElement?.classList.contains("nutrition-info"),
			inPopover: Boolean(document.activeElement?.closest(".nutrition-help")),
			label: document.activeElement?.closest("label")?.textContent.trim(),
		}));
	const openFromKeyboard = async () => {
		await help.focus();
		await page.keyboard.press("Enter");
		await popover.waitFor();
	};
	const close = async () => {
		await page.keyboard.press("Escape");
		await popover.waitFor({ state: "detached" });
		return focused();
	};
	await help.hover();
	await popover.waitFor();
	await moveToHeading();
	await popover.waitFor({ state: "detached" });
	await help.hover();
	await popover.waitFor();
	await help.click();
	await moveToHeading();
	await page.waitForTimeout(HELP_CLOSE_WAIT_MS);
	const clickedStaysOpen = await popover.isVisible();
	await page.keyboard.press("Escape");
	await popover.waitFor({ state: "detached" });
	await page.evaluate(() => {
		// The control after the help, focused as soon as the help appears.
		const next = [...document.querySelectorAll("label")]
			.find((label) => label.textContent.trim() === "Immune support")
			.querySelector("button, input");
		const observer = new MutationObserver(() => {
			if (!document.querySelector(".nutrition-help")) return;
			observer.disconnect();
			next.focus();
		});
		observer.observe(document.body, { childList: true, subtree: true });
	});
	await openFromKeyboard();
	const movedOnOpen = await focused();
	const movedOnOpenClosed = await close();
	await openFromKeyboard();
	const opened = await focused();
	await page.keyboard.press("Tab");
	const tabbed = await focused();
	const tabbedClosed = await close();
	await openFromKeyboard();
	const onTriggerClosed = await close();
	await openFromKeyboard();
	await popover.locator("p").first().click();
	const clickedInside = await focused();
	const clickedInsideClosed = await close();
	// Opened by hover while another control has focus, then clicked into.
	await page.getByRole("checkbox", { name: "Iron-rich", exact: true }).focus();
	await help.hover();
	await popover.waitFor();
	await popover.locator("p").first().click();
	return {
		clickedStaysOpen,
		movedOnOpen,
		movedOnOpenClosed,
		opened,
		tabbed,
		tabbedClosed,
		onTriggerClosed,
		clickedInside,
		clickedInsideClosed,
		hoveredInsideClosed: await close(),
	};
}

// The nutrition help by touch: a tap opens it, a tap elsewhere closes it.
async function touchHelp({ help, popover, heading }) {
	await help.tap();
	await popover.waitFor();
	await heading.tap();
	await popover.waitFor({ state: "detached" });
	return null;
}
const ON_HELP = { onHelp: true, inPopover: false, label: undefined };
const IMMUNE = { onHelp: false, inPopover: false, label: "Immune support" };
const DESKTOP_HELP = {
	clickedStaysOpen: true,
	movedOnOpen: IMMUNE,
	movedOnOpenClosed: IMMUNE,
	opened: ON_HELP,
	tabbed: { ...IMMUNE, label: "Keto" },
	tabbedClosed: { ...IMMUNE, label: "Keto" },
	onTriggerClosed: ON_HELP,
	clickedInside: { onHelp: false, inPopover: true, label: undefined },
	clickedInsideClosed: ON_HELP,
	hoveredInsideClosed: ON_HELP,
};

function collectionsCheck(width) {
	it(`Collection pages navigate without JS and nutrition help respects input at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const plain = await browser.newContext({
			serviceWorkers: "block",
			javaScriptEnabled: false,
			viewport: { width, height: HEIGHT },
		});
		const live = await browser.newContext({
			serviceWorkers: "block",
			viewport: { width, height: HEIGHT },
			hasTouch: width === 390,
			isMobile: width === 390,
		});
		try {
			const page = await plain.newPage();
			await page.goto(`${site.origin}/recipes/meals/`);
			assert.equal(await page.locator(".recipe-card").count(), 6);
			assert.equal(await page.locator(".recipe-detail").count(), 0);
			// The controls need JavaScript, so recipes-no-script.css hides them
			// (hidden controls are counted with includeHidden).
			const servings = page.getByRole("combobox", {
				name: SERVINGS,
				includeHidden: true,
			});
			assert.equal(await servings.count(), 1);
			assert.equal(await servings.isVisible(), false);
			const printAll = page.getByRole("button", {
				name: "Print all meals",
				exact: true,
				includeHidden: true,
			});
			assert.equal(await printAll.count(), 0);
			const next = page
				.getByRole("navigation", { name: "Recipe pages" })
				.getByRole("link", { name: "Next recipes" });
			assert.equal(await next.isVisible(), true);
			assert.equal(
				await next.getAttribute("href"),
				// biome-ignore lint/security/noSecrets: public collection pagination URL, not a credential.
				"/recipes/meals/?browse=1&page=2",
			);
			assert.equal(
				await page
					.getByRole("navigation", {
						name: width === 390 ? "Mobile navigation" : "Primary navigation",
					})
					.getByRole("link", { name: "Blog by John Solly", exact: true })
					.isVisible(),
				true,
			);
			await Promise.all([
				page.waitForURL("**/recipes/smoothies/"),
				page.getByRole("link", { name: "Smoothies", exact: true }).click(),
			]);
			assert.equal(await page.locator(".recipe-card").count(), smoothieCount);
			await Promise.all([
				page.waitForURL("**/recipes/avocado-lime-smoothie/**"),
				page
					.getByRole("link", { name: "Avocado-lime smoothie", exact: true })
					.click(),
			]);
			assert.equal(await page.locator(".recipe-detail").count(), 1);
			const firstCheck = page.locator(NATIVE_CHECKBOX).first();
			await firstCheck.check();
			assert.equal(await firstCheck.isChecked(), true);
			await page.locator(".nutrient-disclosure summary").click();
			await page.locator(".recipe-body .daily-values:visible").waitFor();
			assert.equal(
				await page.locator(".recipe-body .daily-values:visible").isVisible(),
				true,
			);
			await Promise.all([
				page.waitForURL("**/recipes/smoothies/"),
				page
					.getByRole("link", { name: "← Back to smoothies", exact: true })
					.click(),
			]);
			assert.equal(await page.locator(".recipe-card").count(), smoothieCount);

			const enhanced = await live.newPage();
			await enhanced.goto(`${site.origin}/recipes/meals/`);
			await hydrated(enhanced);
			const help = enhanced.getByRole("button", {
				name: "About nutrition filters",
				exact: true,
			});
			const popover = enhanced.locator(".nutrition-help");
			const heading = enhanced.getByRole("heading", {
				name: "Meals",
				exact: true,
			});
			const desktop = width === 1280;
			assert.deepEqual(
				await (desktop ? pointerAndKeyboardHelp : touchHelp)({
					page: enhanced,
					help,
					popover,
					heading,
				}),
				desktop ? DESKTOP_HELP : null,
				"the nutrition help by pointer and keyboard, or by touch",
			);
			await enhanced
				.getByRole("combobox", { name: SERVINGS })
				.selectOption("8");
			await enhanced
				.locator(".recipe-card")
				.filter({ hasText: "Lemon salmon and asparagus" })
				.getByRole("link", {
					name: "Open recipe: Lemon salmon and asparagus",
					exact: true,
				})
				.click();
			await enhanced.waitForURL(
				(url) => url.pathname === "/recipes/lemon-salmon-and-asparagus/",
			);
			await recipeReady(enhanced);
			assert.equal(new URL(enhanced.url()).searchParams.get("servings"), "8");
			assert.match(
				await enhanced.locator(".detail-facts").textContent(),
				EIGHT_SERVINGS,
			);
		} finally {
			await plain.close();
			await live.close();
		}
	});
}

function filterFocusCheck(width) {
	it(`Recipe filters preserve keyboard and outside-control focus at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const context = await browser.newContext({
			serviceWorkers: "block",
			viewport: { width, height: HEIGHT },
		});
		try {
			const page = await context.newPage();
			const checkFilter = async (route, label) => {
				await page.goto(`${site.origin}${route}`);
				await hydrated(page);
				const trigger = page.getByRole("button", {
					name: new RegExp(`^${label}:`, "u"),
				});
				const panel = page.getByRole("dialog", { name: `${label} choices` });
				await page.evaluate(() => {
					window.filterFocusEscapes = [];
					let entered = false;
					document.addEventListener("focusin", (event) => {
						if (event.target.closest(".multi-options")) entered = true;
						else if (entered && document.querySelector(".multi-options")) {
							window.filterFocusEscapes.push(event.target.outerHTML);
						}
					});
				});
				await trigger.focus();
				await page.keyboard.press("Enter");
				await panel.waitFor();
				await page.waitForFunction(() =>
					document.activeElement?.closest(".multi-options"),
				);
				await page.waitForFunction(() => {
					const element = document.querySelector(".multi-options");
					if (!element) return false;
					const bounds = element.getBoundingClientRect();
					return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
				});
				// Let the delayed FocusScope remount settle before keyboard input.
				await page.waitForTimeout(350);
				assert.deepEqual(
					await page.evaluate(() => window.filterFocusEscapes),
					[],
					`${label}: remount never moves focus out of the open panel`,
				);
				const option = panel.getByRole("checkbox").first();
				assert.equal(
					await option.evaluate(
						(element) => element === document.activeElement,
					),
					true,
					`${label}: the open panel retains keyboard focus after remount`,
				);
				const emptySummary = await trigger.textContent();
				await page.keyboard.press("Space");
				assert.equal(await option.getAttribute("aria-checked"), "true");
				assert.notEqual(await trigger.textContent(), emptySummary);
				await page.keyboard.press("Escape");
				await panel.waitFor({ state: "detached" });
				assert.equal(
					await trigger.evaluate(
						(element) => element === document.activeElement,
					),
					true,
					`${label}: Escape returns to the trigger`,
				);
				await trigger.click();
				await panel.waitFor();
				const servings = page.getByRole("combobox", { name: SERVINGS });
				await servings.click();
				await panel.waitFor({ state: "detached" });
				assert.equal(
					await servings.evaluate(
						(element) => element === document.activeElement,
					),
					true,
					`${label}: clicking Servings keeps its focus`,
				);
				await page.keyboard.press("Escape");
				await trigger.click();
				await panel.waitFor();
				// biome-ignore lint/security/noSecrets: CSS selector, not a credential.
				await panel.locator("button:not([disabled])").last().focus();
				await page.keyboard.press("Tab");
				assert.equal(
					await page.evaluate(() =>
						Boolean(document.activeElement?.closest(".multi-options")),
					),
					false,
					`${label}: Tab can leave the nonmodal filter`,
				);
				// Catch autofocus that steals focus back on a later frame or remount.
				await page.waitForTimeout(350);
				assert.equal(
					await page.evaluate(() =>
						Boolean(document.activeElement?.closest(".multi-options")),
					),
					false,
					`${label}: autofocus does not reclaim focus after Tab`,
				);
			};
			for (const [route, label] of [
				["/recipes/meals/", "Proteins"],
				["/recipes/meals/", "Carbs"],
				["/recipes/smoothies/", "Ingredients"],
			]) {
				// biome-ignore lint/performance/noAwaitInLoops: scenarios reuse one page in order.
				await checkFilter(route, label);
			}
		} finally {
			await context.close();
		}
	});
}

for (const width of WIDTHS) {
	filterFocusCheck(width);
	detailsCheck(width);
	filtersCheck(width);
	collectionsCheck(width);
	for (const type of ["meal", "smoothie"]) {
		detailParityCheck(
			recipes.find((recipe) => recipe.type === type),
			width,
		);
	}
}
