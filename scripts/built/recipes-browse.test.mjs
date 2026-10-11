import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import {
	carbStyles,
	mealStyleDescriptions,
} from "../../src/components/recipes/constants.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";

// Browsing the built recipe library in Chromium, ported from awesome-blog's
// PWA suite (scripts/recipes/pwa.test.mjs) without its service worker: every
// recipe page with and without JavaScript and its share link, the Easy Meals
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
const mealCount = meals.length;
const MEAL_STYLES = ["keto", "nonketo", "shared", "all"];
// The meals that need both air fryers.
const AIR_FRYER_MEALS = recipes
	.filter((recipe) => recipe.appliancesNeeded.includes("Two air fryers"))
	.map((recipe) => recipe.id)
	.sort();
const smoothieCount = recipes.filter(
	(recipe) => recipe.type === "smoothie",
).length;
const WIDTHS = [390, 1280];
const HEIGHT = 900;
// A wrapping label names a select after its text and its current option.
const SERVINGS = /^Servings/u;
const FAMILY_SIDE = /^Family side/u;
const VITAMINS = /^Vitamins & minerals/u;
const PROTEINS = /^Proteins:/u;
const CARBS = /^Carbs:/u;
const INGREDIENTS = /^Ingredients:/u;
const SPACES = /\s+/gu;
const PITA_SIDE = /480g Pita/u;
const EIGHT_SERVINGS_CHICKEN = /1360g/u;
const RICE_SIDE = /160g Cooked rice/u;
const TWO_SERVINGS_CHICKEN = /340g/u;
const BEFORE_YOU_START = /Before you start/u;
const COOK = /Cook/u;
const SMOOTHIE_YIELD = /up to two servings/u;
const GLASS_NUTRITION = /Nutrition per 8 oz glass/u;
const EIGHT_SERVINGS_WATER = /27 oz Cold water/u;
const EIGHT_SERVINGS = /8\s+servings/u;
// Longer than the help popover's 120ms close delay.
const HELP_CLOSE_WAIT_MS = 400;
const LEARN_MORE = "Learn more about Tabular Recipe Notation";
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const NATIVE_CHECKBOX = ".trn-ingredient input[type=checkbox]";
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

function detailsCheck(width) {
	it(`Recipe details match without JavaScript and share their settings at ${width}px`, {
		timeout: 120_000,
	}, async () => {
		const viewport = { width, height: HEIGHT };
		const plain = await browser.newContext({
			javaScriptEnabled: false,
			viewport,
			reducedMotion: "reduce",
		});
		const context = await browser.newContext({
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
			assert.equal(await staticPage.locator(".recipe-card").count(), mealCount);
			assert.equal(await staticPage.locator(".recipe-detail").count(), 0);
			const bodyContent = async (body) => ({
				appliances: await body.locator(".detail-appliances").textContent(),
				facts: await body.locator(".detail-facts").textContent(),
				image: await body.locator(".recipe-photo img").getAttribute("src"),
				flow: await body
					.locator(".trn-table tr:not(.reset-checks-row)")
					.allInnerTexts(),
				macros: await body.locator(".nutrition>dl").textContent(),
				nutrients: await body.locator(".daily-values:visible").allInnerTexts(),
				family: await body.locator(".family-box p").allTextContents(),
			});
			const normalize = (value) =>
				JSON.stringify(value, (_key, item) =>
					typeof item === "string" ? item.replace(SPACES, " ").trim() : item,
				);
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
				mealCount,
			);
			assert.equal(
				await page.locator(".time-number").filter({ hasText: "+" }).count(),
				0,
			);
			assert.equal(
				await page.getByText("Prep time (publisher)", { exact: true }).count(),
				0,
			);
			for (const recipe of recipes) {
				// biome-ignore lint/performance/noAwaitInLoops: one recipe at a time on the two pages
				await page.goto(`${site.origin}/recipes/${recipe.id}/`);
				await staticPage.goto(`${site.origin}/recipes/${recipe.id}/`);
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
				await staticBody
					.locator("summary")
					.filter({ hasText: VITAMINS })
					.click();
				assert.equal(
					normalize(await bodyContent(live)),
					normalize(await bodyContent(staticBody)),
					recipe.id,
				);
			}
			await page.goto(
				`${site.origin}${SHARED}?servings=8&starch=shawarma-chicken-bowls:pita_one`,
			);
			const share = page.getByRole("button", {
				name: "Share recipe",
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
			const receiver = await browser.newContext({ viewport });
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
			const fresh = await browser.newContext({ viewport });
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
			assert.equal(await page.locator(".recipe-detail").isVisible(), false);
			const printed = await page.locator(".print-document").textContent();
			assert.match(printed, BEFORE_YOU_START);
			assert.match(printed, COOK);
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
			assert.deepEqual(errors, []);
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
			viewport: { width, height: 984 },
		});
		const page = await context.newPage();
		const errors = collectErrors(page);
		const checkbox = (name) =>
			page.getByRole("checkbox", { name, exact: true });
		const cards = () => page.locator(".recipe-card").count();
		const mealStyle = page.getByRole("combobox", { name: "Meal style" });
		const shownIds = () =>
			page
				.locator(".recipe-card a.title-button")
				.evaluateAll((links) =>
					links.map((link) => link.dataset.recipeId).sort(),
				);
		try {
			await page.goto(`${site.origin}${LANDING}`);
			await hydrated(page);
			// Each meal style shows its group's meals and says what it means.
			const styles = [];
			for (const style of MEAL_STYLES) {
				// biome-ignore lint/performance/noAwaitInLoops: one select change at a time
				await mealStyle.selectOption(style);
				styles.push({
					style,
					cards: await cards(),
					description: await page.locator(".style-filter small").textContent(),
				});
			}
			assert.deepEqual(
				styles,
				MEAL_STYLES.map((style) => ({
					style,
					cards:
						style === "all"
							? mealCount
							: meals.filter((recipe) => recipe.group === style).length,
					description: mealStyleDescriptions[style],
				})),
			);
			assert.deepEqual(
				await mealStyle
					.locator("option")
					.evaluateAll((options) => options.map((option) => option.value)),
				["all", ...Object.keys(carbStyles)],
			);
			// Re-ticking Air fryers brings back its two and their meals.
			await checkbox("Air fryers").uncheck();
			const withoutFryers = await shownIds();
			await checkbox("Air fryers").check();
			const withFryers = await shownIds();
			assert.deepEqual(
				{
					hidden: AIR_FRYER_MEALS.filter((id) => withoutFryers.includes(id)),
					back: AIR_FRYER_MEALS.filter((id) => withFryers.includes(id)),
					count: await page
						.getByRole("combobox", { name: "Air fryers count", exact: true })
						.inputValue(),
				},
				{ hidden: [], back: AIR_FRYER_MEALS, count: "2" },
			);
			await page.getByRole("button", { name: PROTEINS }).click();
			await checkbox("Fish").check();
			await checkbox("Turkey").check();
			await page.keyboard.press("Escape");
			// No fish or turkey meal is Not Keto, so that style is unavailable.
			assert.deepEqual(
				await mealStyle
					.locator("option:disabled")
					.evaluateAll((options) => options.map((option) => option.value)),
				["nonketo"],
			);
			await page.getByRole("button", { name: CARBS }).click();
			assert.equal(await checkbox("No starch").count(), 0);
			await checkbox("Bread").check();
			await page.keyboard.press("Escape");
			await page
				.getByRole("combobox", { name: "Pressure cookers count", exact: true })
				.selectOption("0");
			await page
				.getByRole("combobox", { name: "Air fryers count", exact: true })
				.selectOption("0");
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
			assert.equal(await checkbox("Vegetarian").isDisabled(), true);
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
			// Smoothies have no meal styles: the select is not offered.
			assert.equal(
				await page
					.getByRole("combobox", { name: "Meal style", includeHidden: true })
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
			await page.waitForFunction(() =>
				[...document.querySelectorAll(".recipe-card img")].every(
					(image) => image.complete && image.naturalWidth > 0,
				),
			);
			await Promise.all([
				page.waitForURL("**/recipes/avocado-lime-smoothie/**"),
				page
					.getByRole("link", { name: "Avocado-lime smoothie", exact: true })
					.click(),
			]);
			await recipeReady(page);
			await page.getByRole("button", { name: LEARN_MORE, exact: true }).click();
			await page.locator(".method-dialog").waitFor();
			await page.keyboard.press("Escape");
			await page.locator(".method-dialog").waitFor({ state: "detached" });
			assert.equal(await page.locator(".recipe-detail").isVisible(), true);
			await follow(
				page,
				page.getByRole("link", { name: "← Back to smoothies", exact: true }),
				"**/recipes/smoothies/",
			);
			await page.goBack();
			await page.locator(".recipe-detail").waitFor();
			await page.goForward();
			await hydrated(page);
			await page.evaluate(
				(key) =>
					localStorage.setItem(
						key,
						JSON.stringify({ filters: { ironRich: true }, servings: 8 }),
					),
				STORAGE_KEY,
			);
			await page.goto(
				`${site.origin}${LANDING}?deep-link=1#strawberry-banana-smoothie`,
			);
			const takeover = page.locator(".recipe-takeover");
			await takeover.waitFor();
			const opened = await takeover.textContent();
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
			assert.equal(
				await page.locator(".recipe-takeover .reset-checks-row").count(),
				1,
			);
			assert.match(
				await page.locator(".recipe-takeover .trn-table").textContent(),
				EIGHT_SERVINGS_WATER,
			);
			await page.keyboard.press("Escape");
			await takeover.waitFor({ state: "detached" });
			assert.equal(await cards(), smoothieCount);
			assert.equal((await stored(page)).filters.ironRich, true);
			assert.equal(await checkbox("Iron-rich").count(), 0);
			assert.deepEqual(errors, []);
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
	await heading.hover();
	await popover.waitFor({ state: "detached" });
	await help.hover();
	await popover.waitFor();
	await help.click();
	await heading.hover();
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
	tabbed: IMMUNE,
	tabbedClosed: IMMUNE,
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
			javaScriptEnabled: false,
			viewport: { width, height: HEIGHT },
		});
		const live = await browser.newContext({
			viewport: { width, height: HEIGHT },
			hasTouch: width === 390,
			isMobile: width === 390,
		});
		try {
			const page = await plain.newPage();
			await page.goto(`${site.origin}/recipes/meals/`);
			assert.equal(await page.locator(".recipe-card").count(), mealCount);
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
			assert.equal(await printAll.count(), 1);
			assert.equal(await printAll.isVisible(), false);
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
			await Promise.all([
				enhanced.waitForURL("**/recipes/lemon-salmon-and-asparagus/**"),
				enhanced
					.locator(".recipe-card")
					.filter({ hasText: "Lemon salmon and asparagus" })
					.getByRole("link", { name: "See recipe", exact: true })
					.click(),
			]);
			await recipeReady(enhanced);
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
				await panel.getByRole("button", { name: "Clear selections" }).focus();
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
}
