// biome-ignore-all lint/performance/noAwaitInLoops: browser scenarios and screenshots intentionally operate on the same page sequentially.

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { STORAGE_KEY } from "../../src/components/recipes/constants.mjs";
import { launchTestBrowser } from "../network/browser.ts";
import { collectErrors, serveStaticHttps } from "./pages.mjs";
import { legacyUnits, setLegacyUnits } from "./recipe-legacy-units.mjs";

let site;
let browser;
before(async () => {
	site = await serveStaticHttps("dist");
	browser = await launchTestBrowser({ ignoreCertificateErrors: true });
});
after(async () => {
	await browser?.close();
	await site?.close();
});
const ready = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
const SERVINGS = /^Servings/u;
const FAMILY_SIDE = /^Add a side/u;
const recipeId = "shawarma-chicken-bowls";

async function openSafariPrintPages(width) {
	const context = await browser.newContext({
		viewport: { width, height: 900 },
		reducedMotion: "reduce",
		serviceWorkers: "block",
		ignoreHTTPSErrors: true,
	});
	let safari;
	const close = async () => {
		const contexts = safari ? [context, safari] : [context];
		await Promise.all(contexts.map((entry) => entry.close()));
	};
	try {
		safari = await browser.newContext({
			serviceWorkers: "block",
			viewport: { width, height: 900 },
			ignoreHTTPSErrors: true,
		});
		await context.addInitScript(() => {
			Object.defineProperty(navigator, "userAgent", {
				value: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X)",
			});
			Object.defineProperty(navigator, "standalone", { value: true });
			window.printCalls = 0;
			window.print = () => {
				window.printCalls++;
			};
		});
		const page = await context.newPage();
		const browserPage = await safari.newPage();
		return { page, browserPage, close };
	} catch (error) {
		await close();
		throw error;
	}
}

function verifySafariPrint(width) {
	it(`Home Screen recipe printing hands settings to a browser from page and card at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const origin = site.origin;
		const { page, browserPage, close } = await openSafariPrintPages(width);
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(`${origin}/recipes/${recipeId}/?servings=2&units=grams`);
			await ready(page);
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("6");
			await setLegacyUnits(page, "metric");
			await page
				.getByRole("combobox", { name: FAMILY_SIDE })
				.selectOption("pita_one");
			for (const view of ["page", "card"]) {
				if (view === "card") {
					await page.goto(
						`${origin}/recipes/?servings=6&units=metric&starch=${recipeId}:pita_one`,
					);
					await ready(page);
				}
				const action =
					view === "card"
						? page
								.locator(".recipe-card")
								.filter({ has: page.locator(`[data-recipe-id="${recipeId}"]`) })
						: page;
				await action
					.getByRole("button", { name: "Print recipe", exact: true })
					.click();
				const link = page.getByRole("textbox", {
					name: "Recipe link for Safari",
				});
				await link.waitFor({ state: "visible" });
				const href = await link.inputValue();
				const openSafari = page.getByRole("link", {
					name: "Open in Safari",
					exact: true,
				});
				assert.equal(await openSafari.isVisible(), true);
				assert.equal(await openSafari.getAttribute("href"), `x-safari-${href}`);
				await action
					.getByRole("button", { name: "Print recipe", exact: true })
					.focus();
				await page.keyboard.press("Tab");
				assert.equal(
					await openSafari.evaluate(
						(element) => element === document.activeElement,
					),
					true,
				);
				const url = new URL(href);
				assert.equal(url.origin, origin);
				assert.equal(url.protocol, "https:");
				assert.equal(url.pathname, `/recipes/${recipeId}/`);
				assert.equal(url.searchParams.get("servings"), "6");
				assert.equal(url.searchParams.get("units"), "metric");
				assert.equal(url.searchParams.get("starch"), `${recipeId}:pita_one`);
				assert.equal(await page.evaluate(() => window.printCalls), 0);
				assert.equal(
					await page.locator("html").getAttribute("data-recipe-print"),
					null,
				);
				await browserPage.goto(href);
				await ready(browserPage);
				assert.equal(
					await browserPage
						.getByRole("combobox", { name: SERVINGS })
						.inputValue(),
					"6",
				);
				assert.equal(await legacyUnits(browserPage), "metric");
				assert.equal(
					await browserPage
						.getByRole("combobox", { name: FAMILY_SIDE })
						.inputValue(),
					"pita_one",
				);
				await browserPage.evaluate(() => {
					window.printCalls = 0;
					window.print = () => {
						window.printCalls++;
						window.dispatchEvent(new Event("beforeprint"));
						window.dispatchEvent(new Event("afterprint"));
					};
				});
				await browserPage
					.getByRole("button", { name: "Print recipe", exact: true })
					.click();
				assert.equal(await browserPage.evaluate(() => window.printCalls), 1);
				assert.equal(
					await browserPage
						.getByRole("textbox", { name: "Recipe link for Safari" })
						.count(),
					0,
				);
				if (process.env.UI_EVIDENCE_DIR) {
					await mkdir(process.env.UI_EVIDENCE_DIR, { recursive: true });
					for (const colorScheme of ["light", "dark"]) {
						await page.emulateMedia({ colorScheme });
						await page.screenshot({
							path: `${process.env.UI_EVIDENCE_DIR}/safari-print-${view}-${width}-${colorScheme}.png`,
						});
					}
				}
			}
			// Playwright emits this warning for the intentionally blocked worker;
			// application warnings and errors must still fail the scenario.
			assert.deepEqual(
				errors.filter(
					(message) =>
						message !== "Service Worker registration blocked by Playwright",
				),
				[],
			);
		} finally {
			await close();
		}
	});
}

verifySafariPrint(390);
verifySafariPrint(1280);

it("Home Screen Print all meals handoff replaces Safari's saved meal sides at 390px", {
	timeout: 60_000,
}, async () => {
	const origin = site.origin;
	const {
		page: app,
		browserPage: safari,
		close,
	} = await openSafariPrintPages(390);
	const errors = collectErrors(app);
	try {
		await app.goto(`${origin}/recipes/${recipeId}/`);
		await ready(app);
		await app
			.getByRole("combobox", { name: FAMILY_SIDE })
			.selectOption("pita_one");
		const starch = `${recipeId}:pita_one`;
		await app.waitForURL(
			(recipeUrl) => recipeUrl.searchParams.get("starch") === starch,
		);

		await app.goto(`${origin}/recipes/meals/`);
		await ready(app);
		await app.getByRole("button", { name: "Print all meals" }).click();
		const link = app.getByRole("textbox", {
			name: "Collection link for Safari",
		});
		await link.waitFor({ state: "visible" });
		const href = await link.inputValue();
		const url = new URL(href);
		assert.equal(url.origin, origin);
		assert.equal(url.protocol, "https:");
		assert.equal(url.pathname, "/recipes/meals/");
		assert.equal(url.searchParams.get("starch"), starch);
		assert.equal(
			await app
				.getByRole("link", { name: "Open in Safari" })
				.getAttribute("href"),
			`x-safari-${href}`,
		);
		assert.equal(await app.evaluate(() => window.printCalls), 0);

		await safari.goto(`${origin}/recipes/meals/`);
		await ready(safari);
		await safari.evaluate(
			([key, familyChoice]) =>
				localStorage.setItem(key, JSON.stringify({ familyChoice })),
			[
				STORAGE_KEY,
				{ [recipeId]: "rice_half_cup", "greek-turkey-patties": "bun_one" },
			],
		);
		await safari.goto(href);
		await ready(safari);
		await safari.waitForFunction(
			([key, id]) => {
				const sides = JSON.parse(localStorage.getItem(key)).familyChoice;
				return sides[id] === "pita_one" && !("greek-turkey-patties" in sides);
			},
			[STORAGE_KEY, recipeId],
		);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

it("Home Screen teardown stays on loopback HTTPS while background library loads start", {
	timeout: 60_000,
}, async () => {
	const origin = new URL(site.origin);
	assert.equal(origin.protocol, "https:");
	assert.equal(origin.hostname, "127.0.0.1");
	const {
		page: app,
		browserPage: safari,
		close,
	} = await openSafariPrintPages(390);
	const errors = collectErrors(app, { warnings: true });
	try {
		const safariSummaryStarted = safari.waitForRequest((request) =>
			request.url().includes("/recipes/data/summaries/"),
		);
		await safari.goto(`${site.origin}/recipes/meals/`);
		await ready(safari);
		await safariSummaryStarted;
		await app.goto(`${site.origin}/recipes/meals/`);
		await ready(app);
	} finally {
		await close();
	}
	assert.deepEqual(
		errors.filter(
			(message) =>
				message !== "Service Worker registration blocked by Playwright",
		),
		[],
	);
});
