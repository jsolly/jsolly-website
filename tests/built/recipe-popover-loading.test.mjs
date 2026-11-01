import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { serveStatic } from "./pages.mjs";

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
const PROTEINS = /^Proteins:/u;

function deferredPanelCheck(width) {
	it(`Deferred recipe panels retain focus when Tab precedes their import at ${width}px`, async () => {
		const check = async (name) => {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				serviceWorkers: "block",
			});
			let release;
			try {
				const page = await context.newPage();
				const errors = [];
				page.on("pageerror", (error) => errors.push(error.message));
				let requested;
				let requestedPanel = false;
				const held = new Promise((resolve) => {
					release = resolve;
				});
				const started = new Promise((resolve) => {
					requested = resolve;
				});
				await page.route("**/popover-content.*.js", async (route) => {
					requestedPanel = true;
					requested();
					await held;
					await route.continue();
				});
				await page.goto(`${site.origin}/recipes/meals/`);
				await page.waitForFunction(
					() => !document.querySelector("astro-island[ssr]"),
				);
				assert.equal(
					requestedPanel,
					false,
					"the initial page does not load the panel module",
				);
				const trigger = page.getByRole("button", { name });
				await trigger.focus();
				await page.keyboard.press("Enter");
				await started;
				await page.keyboard.press("Tab");
				const focused = await page.evaluateHandle(() => document.activeElement);
				release();
				// Let import, layout and the library's delayed focus-scope remount settle.
				await page.waitForTimeout(600);
				assert.equal(
					await focused.evaluate(
						(element) => element === document.activeElement,
					),
					true,
				);
				await page.keyboard.press("Escape");
				await trigger.click();
				const panel =
					name === PROTEINS
						? page.getByRole("dialog", { name: "Proteins choices" })
						: page.locator(".nutrition-help");
				await panel.waitFor({ state: "visible" });
				const expectedFocus =
					name === PROTEINS ? panel.getByRole("checkbox").first() : trigger;
				assert.equal(
					await expectedFocus.evaluate(
						(element) => element === document.activeElement,
					),
					true,
				);
				await page.keyboard.press("Escape");
				await panel.waitFor({ state: "detached" });
				assert.deepEqual(errors, []);
			} finally {
				release?.();
				await context.close();
			}
		};
		await check(PROTEINS);
		await check("About nutrition filters");
	});
}

for (const width of [390, 1280]) deferredPanelCheck(width);
