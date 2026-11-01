import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { postHref } from "../../src/lib/blog/urls.js";
import { collectErrors, serveStatic, stubOffOrigin } from "./pages.mjs";

// The post page's own script over the built dist/, in Chromium: a heading
// link copies the heading's jsolly.com address (the canonical URL plus its
// fragment) and announces it in #heading-copy-status on every copy, and
// "Print this post" opens the print dialog (window.print, stubbed here).
const DIST = "dist";
const SITE = "https://www.jsolly.com";
const SLUG = "how-to-get-a-perfect-mozilla-observatory-score";
// The post's h1 id, a legacy fragment (legacy/blogthedata/fragment-ids.json).
const TITLE_ID =
	"how-i-improved-my-security-score-with-mozilla-observatory-a-guide";
const COPIED = "Heading link copied.";

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

it("a post's heading link copies its jsolly.com address and announces every copy, and Print calls window.print", async () => {
	const context = await browser.newContext();
	try {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: site.origin,
		});
		await stubOffOrigin(context, site.origin);
		await context.addInitScript(() => {
			window.__prints = 0;
			window.print = () => {
				window.__prints += 1;
			};
		});
		const page = await context.newPage();
		page.setDefaultTimeout(5000);
		const errors = collectErrors(page);
		await page.goto(`${site.origin}${postHref(SLUG)}`, {
			waitUntil: "load",
		});
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		const status = page.locator("#heading-copy-status");
		const headingLink = page.locator(`h1#${TITLE_ID} .heading-link`);
		await headingLink.click();
		await page.waitForFunction(
			(text) =>
				document.querySelector("#heading-copy-status").textContent === text,
			COPIED,
		);
		assert.equal(
			await page.evaluate(() => navigator.clipboard.readText()),
			`${SITE}${postHref(SLUG)}#${TITLE_ID}`,
		);
		// A second copy empties the region and fills it again, so it is
		// announced again; the message then clears on its own.
		await page.evaluate(() => {
			window.__statusTexts = [];
			new MutationObserver(() => {
				window.__statusTexts.push(
					document.querySelector("#heading-copy-status").textContent,
				);
			}).observe(document.querySelector("#heading-copy-status"), {
				childList: true,
				characterData: true,
				subtree: true,
			});
		});
		await headingLink.click();
		await page.waitForFunction(
			(text) => window.__statusTexts.at(-1) === text,
			COPIED,
		);
		assert.deepEqual(await page.evaluate(() => window.__statusTexts), [
			"",
			COPIED,
		]);
		await page.waitForFunction(
			() => document.querySelector("#heading-copy-status").textContent === "",
		);
		assert.equal(await status.getAttribute("role"), "status");
		await page.locator("#print-article").click();
		assert.equal(await page.evaluate(() => window.__prints), 1);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

function headingCopyFailureCheck(failure) {
	it(`heading navigation survives ${failure} clipboard access and reports only unexpected failures`, async () => {
		const context = await browser.newContext();
		try {
			await stubOffOrigin(context, site.origin);
			await context.addInitScript((scenario) => {
				Object.defineProperty(navigator, "clipboard", {
					value:
						scenario === "unavailable"
							? undefined
							: {
									writeText: () =>
										Promise.reject(
											scenario === "permission"
												? new DOMException("Copy denied", "NotAllowedError")
												: new Error("Clipboard service failed"),
										),
								},
				});
			}, failure);
			const page = await context.newPage();
			const errors = collectErrors(page);
			await page.goto(`${site.origin}${postHref(SLUG)}`);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			await page.locator(`h1#${TITLE_ID} .heading-link`).click();
			await page.waitForURL(`**/#${TITLE_ID}`);
			assert.equal(
				await page.locator("#heading-copy-status").textContent(),
				"",
			);
			assert.deepEqual(
				errors.map((error) => error.split("\n")[0]),
				failure === "unexpected"
					? [
							"Copying blog heading link failed. Error: Clipboard service failed",
						]
					: [],
			);
		} finally {
			await context.close();
		}
	});
}

for (const failure of ["unavailable", "permission", "unexpected"])
	headingCopyFailureCheck(failure);
