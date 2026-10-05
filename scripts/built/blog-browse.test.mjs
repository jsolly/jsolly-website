import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import {
	exists,
	publishedPosts,
	serveStatic,
	stubOffOrigin,
} from "./pages.mjs";

// The blog home, archive and category pages over the built dist/. The first
// two browser tests are ported from awesome-blog's browse tests and re-pathed
// to /blog/: three cards at first, three more per batch, three automatic
// batches on scroll before the button takes over, and ?page= in the URL so a
// reload or Back returns to the same list. Article images come from the
// legacy CloudFront host, so every off-origin request gets a stand-in image.
const DIST = "dist";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const CATEGORY_HREF = /^\/blog\/category\/[^/]+\/$/u;

let site;
let browser;
let published;

before(async () => {
	site = await serveStatic(DIST);
	browser = await chromium.launch();
	published = await publishedPosts();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

async function openPage({
	observer = true,
	viewport = DESKTOP,
	javaScriptEnabled = true,
} = {}) {
	const context = await browser.newContext({ viewport, javaScriptEnabled });
	if (!observer) {
		await context.addInitScript(() => {
			Reflect.deleteProperty(window, "IntersectionObserver");
		});
	}
	await stubOffOrigin(context, site.origin);
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.setDefaultTimeout(5000);
	return { context, page, errors };
}

// Astro drops an island's ssr attribute once it hydrates; the header menu and
// the post cards are separate islands, so wait for every one.
async function navigate(page, path = "/blog/") {
	await page.goto(`${site.origin}${path}`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
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

function loadMore(page) {
	return page.getByRole("link", { name: "Load more posts", exact: true });
}

// Reads a built page with `read(document)`, closing the DOM afterwards.
async function readBuilt(path, read) {
	const dom = new JSDOM(await readFile(join(DIST, path, "index.html"), "utf8"));
	try {
		return read(dom.window.document);
	} finally {
		dom.window.close();
	}
}

function categoryLinks(document) {
	return [...document.querySelectorAll(".post-card .post-meta a")].map((link) =>
		link.getAttribute("href"),
	);
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
		await loadMore(page).focus();
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
		assert.equal(
			new URL(page.url()).searchParams.get("page"),
			"8",
			"the URL records the 8 loaded batches before leaving",
		);
		const target = page.locator(".post-card-link").nth(5);
		const href = await target.getAttribute("href");
		await target.click();
		await page.waitForURL(`${site.origin}${href}`);
		await page.goBack({ waitUntil: "domcontentloaded" });
		await countIs(page, 24);
		await navigate(page, "/blog/?page=3");
		await countIs(page, 9);
		await navigate(page, "/blog/?page=999");
		const total = published.length;
		await countIs(page, total);
		assert.equal(await loadMore(page).count(), 0);
		assert.equal(
			await page.getByRole("status").textContent(),
			`Showing ${total} of ${total} articles`,
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
		await page.evaluate(() => {
			window.__sameDocument = true;
		});
		await loadMore(page).click();
		await countIs(page, 6);
		assert.equal(new URL(page.url()).searchParams.get("page"), "2");
		// Only the in-place load keeps this document and moves focus to the
		// first new card; following the ?page=2 href would do neither.
		assert.equal(await page.evaluate(() => window.__sameDocument), true);
		await page.waitForFunction(
			() =>
				document.activeElement ===
				document.querySelectorAll(".post-card-link")[3],
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("A keyboard user who reaches Load more on a phone gets no automatic batch until pressing it", async () => {
	const { context, page, errors } = await openPage({ viewport: PHONE });
	try {
		await navigate(page);
		await countIs(page, 3);
		// Focus scrolls the button into view, where the observer would fire.
		await loadMore(page).focus();
		await page.waitForTimeout(300);
		await countIs(page, 3);
		await page.keyboard.press("Enter");
		await countIs(page, 6);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("A ?page= value that is not a positive whole number shows the first three cards", async () => {
	const { context, page, errors } = await openPage();
	const firstBatchAt = async (value) => {
		await navigate(page, `/blog/?page=${value}`);
		assert.equal(await page.locator(".post-card").count(), 3, value);
	};
	try {
		await firstBatchAt("0");
		await firstBatchAt("-2");
		await firstBatchAt("abc");
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("Without JavaScript the blog home offers the full archive instead of Load more, and the archive lists every published post", async () => {
	const { context, page } = await openPage({ javaScriptEnabled: false });
	try {
		await page.goto(`${site.origin}/blog/`);
		assert.equal(await page.locator(".post-card").count(), 3);
		assert.equal(
			await page.locator(".load-more").isVisible(),
			false,
			"no-script.css hides Load more, which needs JavaScript",
		);
		const archive = page.getByRole("link", {
			name: "Browse every article without JavaScript",
		});
		assert.equal(await archive.isVisible(), true);
		await Promise.all([page.waitForURL("**/blog/all-posts/"), archive.click()]);
		const hrefs = await cardHrefs(page);
		assert.deepEqual(
			[...hrefs].sort(),
			published.map(({ slug }) => `/blog/${slug}/`).sort(),
			"the archive lists exactly the published posts",
		);
	} finally {
		await context.close();
	}
});

it("Category pages list only their own published posts, an empty category says so, and every card's category link is a built page", async () => {
	const geodevSlugs = published
		.filter(({ category }) => category === "Geodev")
		.map(({ slug }) => `/blog/${slug}/`);
	assert.ok(geodevSlugs.length > 3, "Geodev has more than one batch");
	const firstBatch = await readBuilt("blog/category/Geodev", (document) => ({
		links: categoryLinks(document),
		status: document.querySelector(".load-more [role=status]")?.textContent,
	}));
	assert.deepEqual(firstBatch, {
		links: Array.from({ length: 3 }, () => "/blog/category/Geodev/"),
		status: `Showing 3 of ${geodevSlugs.length} articles`,
	});
	const { context, page, errors } = await openPage();
	try {
		await navigate(page, "/blog/category/Geodev/?page=999");
		await countIs(page, geodevSlugs.length);
		assert.deepEqual(
			(await cardHrefs(page)).sort(),
			[...geodevSlugs].sort(),
			"every published Geodev post, and nothing else",
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}

	const empty = await readBuilt("blog/category/uncategorized", (document) => ({
		cards: document.querySelectorAll(".post-card").length,
		notice: document
			.querySelector("main")
			.textContent.includes("No posts in this category yet."),
	}));
	assert.deepEqual(empty, { cards: 0, notice: true });

	const archiveLinks = await readBuilt("blog/all-posts", categoryLinks);
	assert.equal(archiveLinks.length, published.length);
	const links = [...new Set(archiveLinks)].sort();
	const unbuilt = (
		await Promise.all(
			links.map(async (href) =>
				CATEGORY_HREF.test(href) &&
				(await exists(join(DIST, href, "index.html")))
					? []
					: [href],
			),
		)
	).flat();
	assert.deepEqual(unbuilt, [], "category links without a built page");
	assert.deepEqual(
		links,
		[
			...new Set(
				published.map(({ category }) => `/blog/category/${category}/`),
			),
		].sort(),
		"the links keep each category slug's case",
	);
});
