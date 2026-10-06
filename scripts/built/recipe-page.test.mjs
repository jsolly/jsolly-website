import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { serveStatic } from "./pages.mjs";

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
const SIDE_LABEL = "Bun";
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const NATIVE_CHECKBOX = 'input[type="checkbox"]';
const VITAMINS = /Vitamins & minerals/u;
const SERVINGS = /^Servings/u;
const FAMILY_SIDE = /^Family side/u;
const SPACES = /\s+/gu;

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
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`${site.origin}${path}`);
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	await page.getByRole("button", { name: "Print recipe" }).waitFor();
	return { page, errors, close: () => context.close() };
}

it("without JavaScript a recipe page offers native checkboxes, a vitamins details disclosure and a share link, with the print copy hidden", async () => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${site.origin}${PAGE}`);
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
				shareLink: await detail
					.getByRole("link", { name: "Share recipe link" })
					.getAttribute("href"),
				shareButton: await detail
					.getByRole("button", { name: "Share recipe" })
					.count(),
				printCopyShown: await page.locator(".print-document").isVisible(),
				methodLink: await detail.locator("a.learn-method").getAttribute("href"),
			},
			{
				nativeChecks: true,
				labelTicksBox: true,
				shadcnChecks: 0,
				detailsOpen: true,
				shareLink: PAGE,
				shareButton: 0,
				printCopyShown: false,
				methodLink: "https://www.cookingforengineers.com/",
			},
		);
	} finally {
		await context.close();
	}
});

it("a reader on the hydrated page opens the vitamins disclosure, ticks ingredients by box and by label, and Reset clears every tick", async () => {
	const { page, errors, close } = await openHydrated(PAGE);
	try {
		const detail = page.locator(".recipe-detail");
		const trigger = detail.getByRole("button", {
			name: VITAMINS,
		});
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
		};
		const tickedLooksDifferent =
			(await background(first)) !== (await background(checks.nth(2)));
		await detail.getByRole("button", { name: "Reset cooking checks" }).click();
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
				tickedLooksDifferent: true,
				afterReset: 0,
				errors: [],
			},
		);
	} finally {
		await close();
	}
});

it("Learn more opens the notation dialog with focus inside it, and its close button closes it", async () => {
	const { page, errors, close } = await openHydrated(PAGE);
	try {
		await page
			.getByRole("button", { name: "Learn more about Tabular Recipe Notation" })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "Tabular Recipe Notation",
		});
		await dialog.waitFor();
		await page.waitForFunction(() =>
			document.activeElement?.closest("[role=dialog]"),
		);
		const focusOnDialog = await dialog.evaluate(
			(element) => document.activeElement === element,
		);
		await dialog
			.getByRole("button", { name: "Close and continue recipe" })
			.click();
		await dialog.waitFor({ state: "detached" });
		assert.deepEqual(
			{ focusOnDialog, errors },
			{ focusOnDialog: true, errors: [] },
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
				facts: (await detail.locator(".detail-facts").textContent())
					.replace(SPACES, " ")
					.trim(),
				sideLine: (
					await detail.locator(".family-box p").textContent()
				).includes(SIDE_LABEL),
				errors,
			},
			{
				servings: "6",
				side: SIDE,
				facts: "15+ min active time / base batch 6 servings",
				sideLine: true,
				errors: [],
			},
		);
	} finally {
		await close();
	}
});

it("where the browser can neither share nor copy, Share recipe announces and shows the link to copy", async () => {
	const { page, errors, close } = await openHydrated(PAGE, {
		initScript: () => {
			Object.defineProperty(Navigator.prototype, "share", {
				value: undefined,
				configurable: true,
			});
			Object.defineProperty(Navigator.prototype, "clipboard", {
				value: {
					writeText: () => Promise.reject(new Error("clipboard blocked")),
				},
				configurable: true,
			});
		},
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
