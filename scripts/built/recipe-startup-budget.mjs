// biome-ignore-all lint/suspicious/noMisplacedAssertion: Shared browser assertions called only from Vitest tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

/** Measure delivered startup scripts, including worker installation, before summary demand. */
export async function assertRecipeStartupBudget(browser, origin) {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const summaryDemand = Promise.withResolvers();
	const scripts = new Set(["/recipes/service-worker.js"]);
	// Let the summary loader arrive, then hold its data response so deferred
	// browse/search engines stay outside the startup measurement.
	await context.route("**/recipes/data/summaries/**", () => {
		summaryDemand.resolve();
		return new Promise(() => {
			/* Keep the download pending until this context closes. */
		});
	});
	context.on("response", (response) => {
		const path = new URL(response.url()).pathname;
		if (response.ok() && path.endsWith(".js")) scripts.add(path);
	});
	try {
		const page = await context.newPage();
		await page.goto(`${origin}/recipes/meals/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		await page.evaluate(() =>
			navigator.serviceWorker.ready.then(() => undefined),
		);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await summaryDemand.promise;
		assert.equal(await page.locator(".recipe-card").count(), 6);
		assert.ok(
			(await readFile("dist/recipes/meals/index.html")).length <= 200_000,
		);
		const sizes = await Promise.all(
			[...scripts].map(
				async (path) => gzipSync(await readFile(`dist${path}`)).length,
			),
		);
		assert.ok(
			sizes.reduce((sum, size) => sum + size, 0) <= 100_000,
			"initial JavaScript, shared chunks and installed worker must fit the gzip budget",
		);
	} finally {
		await context.close();
	}
}
