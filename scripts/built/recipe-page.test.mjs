import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { PRINT_FAILED } from "../../src/components/recipes/constants.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";

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
const FAMILY_SIDE = /^Family side/u;
const SPACES = /\s+/gu;
const LEARN_MORE = "Learn more about Tabular Recipe Notation";

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

// An init script for a browser that can neither share nor copy.
function blockSharing() {
	Object.defineProperty(Navigator.prototype, "share", {
		value: undefined,
		configurable: true,
	});
	Object.defineProperty(Navigator.prototype, "clipboard", {
		value: { writeText: () => Promise.reject(new Error("clipboard blocked")) },
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
	const errors = collectErrors(page, []);
	await page.goto(`${site.origin}${path}`);
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	await page.getByRole("button", { name: "Print recipe" }).waitFor();
	return { page, errors, close: () => context.close() };
}

// Registers the no-JavaScript and hydrated page checks for one recipe page.
function pageChecks({ kind, id, familySides }) {
	it(`without JavaScript the page for ${kind} offers native checkboxes, a vitamins details disclosure and a share link, with the print copy hidden`, async () => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto(`${site.origin}/recipes/${id}/`);
			const detail = page.locator(".recipe-detail");
			const firstCheck = detail.locator(NATIVE_CHECKBOX).first();
			await detail.locator("th.trn-ingredient label").first().click();
			const disclosure = detail.locator("details.nutrient-disclosure");
			await disclosure.locator("summary").click();
			assert.deepEqual(
				{
					nativeChecks: (await detail.locator(NATIVE_CHECKBOX).count()) > 0,
					labelTicksBox: await firstCheck.isChecked(),
					shadcnChecks: await detail.locator("[data-slot=checkbox]").count(),
					detailsOpen: await disclosure.evaluate((element) => element.open),
					familySelect:
						(await detail.locator(".family-box select").count()) > 0,
					shareLink: await detail
						.getByRole("link", { name: "Share recipe link" })
						.getAttribute("href"),
					shareButton: await detail
						.getByRole("button", { name: "Share recipe" })
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
					shareButton: 0,
					printCopyShown: false,
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
				.locator("th.trn-ingredient label")
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
		const learnMore = page.getByRole("button", { name: LEARN_MORE });
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
		await page.getByRole("button", { name: "Print recipe" }).click();
		await page.emulateMedia({ media: "print" });
		const printing = {
			prints: await page.evaluate(() => window.__prints),
			mode: await page.evaluate(() =>
				document.documentElement.getAttribute("data-recipe-print"),
			),
			copyShown: await page.locator(".print-document").isVisible(),
			pageHidden: await page.locator(".recipe-detail").isHidden(),
			breadcrumbsHidden: await page.locator(".breadcrumbs").isHidden(),
		};
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		assert.deepEqual(
			{
				...printing,
				modeAfter: await page.evaluate(() =>
					document.documentElement.getAttribute("data-recipe-print"),
				),
				errors,
			},
			{
				prints: 1,
				mode: "recipe",
				copyShown: true,
				pageHidden: true,
				breadcrumbsHidden: true,
				modeAfter: null,
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
				errors,
			},
			{ status: PRINT_FAILED, mode: null, errors: [] },
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
		await detail.getByRole("combobox", { name: SERVINGS }).selectOption("8");
		await detail
			.getByRole("combobox", { name: FAMILY_SIDE })
			.selectOption(SIDE);
		const share = page.locator(".recipe-share");
		await share.getByRole("button", { name: "Share recipe" }).click();
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
				facts: "15+ min active time / base batch 8 servings",
				sideLine: "360g Bun · serve separately",
				cucumber: "600g",
				link: `${site.origin}${PAGE}?servings=8&starch=greek-turkey-patties%3Abun_one`,
				errors: [],
			},
		);
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
				facts: "15+ min active time / base batch 6 servings",
				sideLine: "270g Bun · serve separately",
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
		await share.getByRole("button", { name: "Share recipe" }).click();
		await status.filter({ hasText: "Copy this recipe link:" }).waitFor();
		assert.deepEqual(
			{
				statusBefore,
				link: await share.getByRole("link").getAttribute("href"),
				errors,
			},
			{
				statusBefore: 1,
				link: `${site.origin}${PAGE}?servings=4`,
				errors: [],
			},
		);
	} finally {
		await close();
	}
});
