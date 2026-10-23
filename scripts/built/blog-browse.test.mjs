import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { categoryHref, postHref } from "../../src/lib/blog/urls.js";
import {
	categorySlugs,
	collectErrors,
	exists,
	publishedPosts,
	readBuilt,
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
const COMMENT = /<!--[\s\S]*?-->/gu;
// Tall enough that the load-more area stays in reach after every batch.
const TALL = { width: 1280, height: 6000 };
// A real post's card on the archive, checked against its frontmatter
// (src/content/blog/posts/optimizing-ahrefs-orphan-pages-duplicate-content.md).
const AHREFS = {
	href: "/blog/optimizing-ahrefs-orphan-pages-duplicate-content/",
	published: "2023-01-09T06:14:18.161Z",
	dateLabel: "January 9, 2023",
	excerpt:
		"<p>Audit your website with Ahrefs to fix orphan pages and duplicate content for better UX, higher SEO, and improved performance.</p>",
};

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
	if (observer === "controlled") {
		await context.addInitScript(() => {
			window.IntersectionObserver = class {
				constructor(callback) {
					this.callback = callback;
				}
				observe(target) {
					if (target.matches(".load-more"))
						window.deliverBlogIntersection = () =>
							this.callback([{ target, isIntersecting: true }], this);
				}
				disconnect() {
					this.callback = undefined;
					window.deliverBlogIntersection = undefined;
				}
			};
		});
	} else if (!observer) {
		await context.addInitScript(() => {
			Reflect.deleteProperty(window, "IntersectionObserver");
		});
	}
	await stubOffOrigin(context, site.origin);
	const page = await context.newPage();
	const errors = collectErrors(page);
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
	try {
		await page.waitForFunction(
			(expected) => document.querySelectorAll(".post-card").length === expected,
			count,
		);
	} catch (error) {
		console.error("Blog card count did not settle", {
			expected: count,
			...(await page.evaluate(() => ({
				actual: document.querySelectorAll(".post-card").length,
				focus: document.activeElement?.className,
				scrollY,
				loadMoreTop: document
					.querySelector(".load-more")
					?.getBoundingClientRect().top,
				fonts: document.fonts.status,
			}))),
		});
		throw error;
	}
}

async function appendByScrolling(page, count) {
	await page.locator(".load-more").scrollIntoViewIfNeeded();
	await loadMoreVisibility(page, false);
	await countIs(page, count);
}

// Let the real observer deliver the previous scroll before issuing another
// input. A rendered batch alone does not mean its async observer callback ended.
async function loadMoreVisibility(page, intersecting) {
	const observerHandle = await page
		.locator(".load-more")
		.evaluateHandle((node, expected) => {
			const observer = new IntersectionObserver((entries) => {
				if (entries.some((entry) => entry.isIntersecting === expected)) {
					observer.complete = true;
					observer.disconnect();
				}
			});
			observer.observe(node);
			return observer;
		}, intersecting);
	try {
		await page.waitForFunction((value) => value.complete, observerHandle);
	} finally {
		await observerHandle.evaluate((value) => value.disconnect());
		await observerHandle.dispose();
	}
}

// Deliver the guard's input explicitly, then let Svelte's DOM updates flush
// before reading the result. Real scrolling remains covered independently.
async function deliverIntersection(page) {
	await page.evaluate(async () => {
		if (!window.deliverBlogIntersection)
			throw new Error("Blog observer is not observing Load more");
		window.deliverBlogIntersection();
		await new Promise(requestAnimationFrame);
	});
}

function cardHrefs(page) {
	return page
		.locator(".post-card-link")
		.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
}

function loadMore(page) {
	return page.getByRole("link", { name: "Load more posts", exact: true });
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
		await countIs(page, 12);
		assert.equal(await page.locator(".load-more-button.paused").count(), 1);
		await loadMore(page).focus();
		await loadMoreVisibility(page, true);
		await page.keyboard.press("Enter");
		await loadMoreVisibility(page, false);
		await countIs(page, 15);
		await page.waitForFunction(
			() =>
				document.activeElement ===
				document.querySelectorAll(".post-card-link")[12],
		);
		await appendByScrolling(page, 18);
		await appendByScrolling(page, 21);
		await appendByScrolling(page, 24);
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
	const { context, page, errors } = await openPage({
		viewport: PHONE,
		observer: "controlled",
	});
	try {
		await navigate(page);
		await countIs(page, 3);
		// Focus scrolls the button into view, where the observer would fire.
		await loadMore(page).focus();
		await deliverIntersection(page);
		assert.equal(await page.locator(".post-card").count(), 3);
		assert.equal(new URL(page.url()).searchParams.get("page"), null);
		await page.keyboard.press("Enter");
		await countIs(page, 6);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("A viewport taller than a batch keeps loading on its own until the automatic batches are spent", async () => {
	const { context, page, errors } = await openPage({ viewport: TALL });
	try {
		await navigate(page);
		// 3 server-rendered cards and 3 automatic batches of 3, with no scrolling.
		await countIs(page, 12);
		await countIs(page, 12);
		assert.equal(await page.locator(".load-more-button.paused").count(), 1);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("intersecting callbacks cannot exceed the automatic budget, and manual loading renews it", async () => {
	const { context, page, errors } = await openPage({
		viewport: TALL,
		observer: "controlled",
	});
	try {
		await navigate(page);
		await deliverIntersection(page);
		await countIs(page, 12);
		await deliverIntersection(page);
		assert.equal(await page.locator(".post-card").count(), 12);
		assert.equal(new URL(page.url()).searchParams.get("page"), "4");
		assert.equal(await page.locator(".load-more-button.paused").count(), 1);
		await loadMore(page).press("Enter");
		await countIs(page, 15);
		await page.waitForFunction(
			() =>
				document.activeElement ===
				document.querySelectorAll(".post-card-link")[12],
		);
		await deliverIntersection(page);
		await deliverIntersection(page);
		await deliverIntersection(page);
		await countIs(page, 24);
		await deliverIntersection(page);
		assert.equal(await page.locator(".post-card").count(), 24);
		assert.equal(new URL(page.url()).searchParams.get("page"), "8");
		assert.equal(await page.locator(".load-more-button.paused").count(), 1);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("An archive card shows its post's publish date, no Updated line on a same-day update, its reading time and its excerpt", async () => {
	const card = await readBuilt("blog/all-posts", (document) => {
		const article = [...document.querySelectorAll(".post-card")].find(
			(element) =>
				element.querySelector(".post-card-link")?.getAttribute("href") ===
				AHREFS.href,
		);
		const meta = [...article.querySelectorAll(".post-meta")];
		const time = meta[0].querySelector("time");
		return {
			time: [time.textContent, time.getAttribute("datetime")],
			meta: meta.map((line) => line.textContent),
			excerpt: article
				.querySelector(".card-excerpt")
				.innerHTML.replace(COMMENT, ""),
		};
	});
	assert.deepEqual(card, {
		time: [AHREFS.dateLabel, AHREFS.published],
		meta: [`${AHREFS.dateLabel} in Web Dev`, "6 min read"],
		excerpt: AHREFS.excerpt,
	});
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
			published.map(({ slug }) => postHref(slug)).sort(),
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

	const used = new Set(published.map(({ category }) => category));
	const emptyCategories = (await categorySlugs()).filter(
		(slug) => !used.has(slug),
	);
	assert.ok(emptyCategories.length > 0, "some category has no published post");
	const empty = await Promise.all(
		emptyCategories.map((slug) =>
			readBuilt(categoryHref(slug), (document) => ({
				slug,
				cards: document.querySelectorAll(".post-card").length,
				notice: document
					.querySelector("main")
					.textContent.includes("No posts in this category yet."),
			})),
		),
	);
	assert.deepEqual(
		empty,
		emptyCategories.map((slug) => ({ slug, cards: 0, notice: true })),
	);

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
			...new Set(published.map(({ category }) => categoryHref(category))),
		].sort(),
		"the links keep each category slug's case",
	);
});
