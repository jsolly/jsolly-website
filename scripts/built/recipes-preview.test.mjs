import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { chromium } from "playwright";
import {
	collectErrors,
	readBuiltPages,
	serveStatic,
	stubOffOrigin,
} from "./pages.mjs";
import { createTempCopy, requireSuccess } from "./temp-copy.mjs";

it("Preview recipe pages reload without installing an offline snapshot", async () => {
	const copy = await createTempCopy("recipe-preview");
	let site;
	let browser;
	try {
		await writeFile(join(copy.dir, ".env"), "VERCEL_ENV=preview\n");
		requireSuccess(copy.astroBuild());
		const dist = join(copy.dir, "dist");
		const pages = (await readBuiltPages(dist)).filter(({ file }) =>
			file.startsWith("recipes/"),
		);
		assert.ok(pages.length > 1);
		for (const { file, html } of pages) {
			assert.ok(!html.includes('id="recipe-offline-status"'), file);
		}
		site = await serveStatic(dist);
		browser = await chromium.launch();
		const page = await browser.newPage();
		const errors = collectErrors(page);
		await stubOffOrigin(page.context(), site.origin);
		await page.addInitScript(() => {
			window.previewRegistrationAttempts = 0;
			const original = navigator.serviceWorker.register.bind(
				navigator.serviceWorker,
			);
			navigator.serviceWorker.register = (...args) => {
				window.previewRegistrationAttempts++;
				return original(...args);
			};
		});
		await page.goto(`${site.origin}/recipes/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(
			await page.evaluate(() => window.previewRegistrationAttempts),
			0,
		);
		// A later build can be seen in the same open tab after a normal reload.
		const indexFile = join(dist, "recipes/index.html");
		const html = await readFile(indexFile, "utf8");
		await writeFile(
			indexFile,
			html.replace(
				"</head>",
				'<meta name="preview-update" content="next"></head>',
			),
		);
		await page.reload();
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(
			await page.locator('meta[name="preview-update"]').getAttribute("content"),
			"next",
		);
		assert.equal(
			await page.evaluate(() => window.previewRegistrationAttempts),
			0,
		);
		assert.equal(
			await page.evaluate(() => navigator.serviceWorker.controller),
			null,
		);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await site?.close();
		await copy.remove();
	}
});
