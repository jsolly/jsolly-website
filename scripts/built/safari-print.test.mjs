// biome-ignore-all lint/performance/noAwaitInLoops: browser scenarios and screenshots intentionally operate on the same page sequentially.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { collectErrors, serveStatic } from "./pages.mjs";

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
const ready = (page) =>
	page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
const SERVINGS = /^Servings/u;
const FAMILY_SIDE = /^Add a side/u;
const ORIGIN = "https://recipe-preview.example.test";
const recipeId = "shawarma-chicken-bowls";

function verifySafariPrint(width) {
	it(`Home Screen recipe printing hands settings to a browser from page and dialog at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			reducedMotion: "reduce",
			serviceWorkers: "block",
		});
		const safari = await browser.newContext({
			serviceWorkers: "block",
			viewport: { width, height: 900 },
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
		// Serve the built bytes at an HTTPS origin without reaching the network.
		const servePreview = async (route) => {
			const response = await route.fetch({
				url: route.request().url().replace(ORIGIN, site.origin),
			});
			await route.fulfill({ response });
		};
		await context.route(`${ORIGIN}/**`, servePreview);
		await safari.route(`${ORIGIN}/**`, servePreview);
		const page = await context.newPage();
		const browserPage = await safari.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(`${ORIGIN}/recipes/${recipeId}/?servings=2&units=grams`);
			await ready(page);
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("6");
			await page
				.getByRole("combobox", { name: "Ingredient units" })
				.selectOption("metric");
			await page
				.getByRole("combobox", { name: FAMILY_SIDE })
				.selectOption("pita_one");
			for (const view of ["page", "dialog", "card"]) {
				if (view === "dialog") {
					await page.goto(
						`${ORIGIN}/recipes/?servings=6&units=metric&starch=${recipeId}:pita_one#${recipeId}`,
					);
					await ready(page);
					await page.getByRole("dialog").waitFor();
				}
				if (view === "card") {
					await page.goto(
						`${ORIGIN}/recipes/?servings=6&units=metric&starch=${recipeId}:pita_one`,
					);
					await ready(page);
				}
				const action =
					view === "card"
						? page
								.locator(".recipe-card")
								.filter({ has: page.locator(`[data-recipe-id="${recipeId}"]`) })
						: view === "dialog"
							? page.getByRole("dialog")
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
				assert.equal(url.origin, ORIGIN);
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
				assert.equal(
					await browserPage
						.getByRole("combobox", { name: "Ingredient units" })
						.inputValue(),
					"metric",
				);
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
			await context.unrouteAll({ behavior: "wait" });
			await safari.unrouteAll({ behavior: "wait" });
			await context.close();
			await safari.close();
		}
	});
}

verifySafariPrint(390);
verifySafariPrint(1280);
