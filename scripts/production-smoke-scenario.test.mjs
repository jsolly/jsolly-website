import assert from "node:assert/strict";
import it from "node:test";
import { chromium } from "playwright";
import { productionUrl, smoke } from "./production-smoke-scenario.mjs";

const EXPECTED_FAILURE = /Timeout/u;

it("mobile navigation without its script fails", async () => {
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		page.setDefaultTimeout(300);
		await context.route("**/*", (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html",
				body: '<h1>Hi, I\'m John Solly.</h1><button aria-label="Toggle mobile menu" aria-expanded="false">Menu</button><nav aria-label="Mobile navigation" hidden>About</nav>',
			}),
		);
		await page.goto(productionUrl);
		await assert.rejects(smoke({ page, context }), EXPECTED_FAILURE);
	} finally {
		await browser.close();
	}
});
