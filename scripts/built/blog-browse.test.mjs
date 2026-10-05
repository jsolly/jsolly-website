import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { serveStatic } from "./pages.mjs";

// The blog home's post cards, ported from awesome-blog's browse tests and
// re-pathed to /blog/: three cards at first, three more per batch, three
// automatic batches on scroll before the button takes over, and ?page= in
// the URL so a reload or Back returns to the same list. Runs against the
// built dist/; article images come from the legacy CloudFront host, so every
// off-origin request gets a stand-in image.
const DIST = "dist";
const OFF_ORIGIN_IMAGE =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';

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

async function openPage({ observer = true } = {}) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
	});
	if (!observer) {
		await context.addInitScript(() => {
			Reflect.deleteProperty(window, "IntersectionObserver");
		});
	}
	await context.route(
		(url) => url.origin !== site.origin,
		(route) =>
			route.fulfill({ contentType: "image/svg+xml", body: OFF_ORIGIN_IMAGE }),
	);
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.setDefaultTimeout(5000);
	return { context, page, errors };
}

// The header menu toggle is enabled on mount, so it marks the islands hydrated.
async function navigate(page, path = "/blog/") {
	await page.goto(`${site.origin}${path}`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(
		() => !document.querySelector(".menu-toggle").disabled,
	);
}

async function countIs(page, count) {
	await page.waitForFunction(
		(expected) => document.querySelectorAll(".post-card").length === expected,
		count,
	);
}

async function appendByScrolling(page, count) {
	await page.locator(".load-more").scrollIntoViewIfNeeded();
	await countIs(page, count);
}

// Lets the observer fire if it still would; the count must not move.
async function settle(page) {
	await page.locator(".load-more").scrollIntoViewIfNeeded();
	await page.waitForTimeout(300);
}

function cardHrefs(page) {
	return page
		.locator(".post-card-link")
		.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
}

it("Scrolling pauses, keyboard loading resumes, and returning preserves the loaded articles", {
	timeout: 30_000,
}, async () => {
	const { context, page, errors } = await openPage();
	try {
		await navigate(page);
		await countIs(page, 3);
		const expected = await cardHrefs(page);
		await appendByScrolling(page, 6);
		await appendByScrolling(page, 9);
		await appendByScrolling(page, 12);
		await settle(page);
		await countIs(page, 12);
		assert.equal(await page.locator(".load-more-button.paused").count(), 1);
		const more = page.getByRole("link", {
			name: "Load more posts",
			exact: true,
		});
		await more.focus();
		await page.keyboard.press("Enter");
		await countIs(page, 15);
		await page.waitForFunction(
			() =>
				document.activeElement ===
				document.querySelectorAll(".post-card-link")[12],
		);
		await appendByScrolling(page, 18);
		await appendByScrolling(page, 21);
		await appendByScrolling(page, 24);
		await settle(page);
		await countIs(page, 24);
		const links = await cardHrefs(page);
		assert.equal(new Set(links).size, 24);
		assert.deepEqual(links.slice(0, 3), expected);
		const target = page.locator(".post-card-link").nth(5);
		const href = await target.getAttribute("href");
		await target.click();
		await page.waitForURL(`${site.origin}${href}`);
		await page.goBack({ waitUntil: "domcontentloaded" });
		await countIs(page, 24);
		await navigate(page, "/blog/?page=3");
		await countIs(page, 9);
		await navigate(page, "/blog/?page=999");
		const count = await page.locator(".post-card").count();
		assert.ok(count > 24);
		assert.equal(
			await page
				.getByRole("link", { name: "Load more posts", exact: true })
				.count(),
			0,
		);
		assert.ok(
			(await page.locator(".load-more").textContent()).includes(
				"You've reached the end",
			),
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("Manual loading remains usable without IntersectionObserver", async () => {
	const { context, page, errors } = await openPage({ observer: false });
	try {
		await navigate(page);
		await countIs(page, 3);
		await page
			.getByRole("link", { name: "Load more posts", exact: true })
			.click();
		await countIs(page, 6);
		assert.equal(new URL(page.url()).searchParams.get("page"), "2");
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
