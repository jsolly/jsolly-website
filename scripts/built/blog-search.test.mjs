import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { postHref } from "../../src/lib/blog/urls.js";
import { publishedPosts, serveStatic, stubOffOrigin } from "./pages.mjs";

// The search page over the built dist/, in Chromium: the island reads
// ?searched=, fetches /blog/search-index.json and shows the matching published
// posts as cards; the form searches again by GET on /blog/search/; and an
// index that fails to load says so and offers a retry and the archive.
const DIST = "dist";
const INDEX = "/blog/search-index.json";
const RESULT_COUNT = /^\d+ results?$/u;
const DJANGO = /django/iu;

let site;
let browser;
let publishedHrefs;

before(async () => {
	site = await serveStatic(DIST);
	browser = await chromium.launch();
	publishedHrefs = new Set(
		(await publishedPosts()).map((post) => postHref(post.slug)),
	);
});

after(async () => {
	await browser?.close();
	await site?.close();
});

async function openSearch(context, query) {
	await stubOffOrigin(context, site.origin);
	const page = await context.newPage();
	page.setDefaultTimeout(5000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	await page.goto(`${site.origin}/blog/search/?searched=${query}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	return { page, errors };
}

// The result count line and the result cards' links, once results show.
async function results(page) {
	await page.locator(".post-card").first().waitFor();
	return {
		count: await page.getByText(RESULT_COUNT).textContent(),
		hrefs: await page
			.locator(".post-card-link")
			.evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
		firstTitle: await page.locator(".post-card-link").first().textContent(),
	};
}

it("a reader arriving with ?searched=django sees that query and published django posts, and the form searches again by GET", async () => {
	const context = await browser.newContext();
	try {
		const { page, errors } = await openSearch(context, "django");
		const django = await results(page);
		assert.equal(
			await page.getByRole("heading", { level: 1 }).textContent(),
			"You searched for 'django'",
		);
		assert.equal(
			await page
				.getByRole("searchbox", { name: "Search articles" })
				.inputValue(),
			"django",
		);
		assert.equal(django.count, `${django.hrefs.length} results`);
		assert.ok(django.hrefs.length > 1, "django matches several posts");
		assert.deepEqual(
			django.hrefs.filter((href) => !publishedHrefs.has(href)),
			[],
			"result cards that are not published posts",
		);
		assert.match(django.firstTitle, DJANGO, "a title match ranks first");

		const searchbox = page.getByRole("searchbox", { name: "Search articles" });
		await searchbox.fill("htmx");
		await Promise.all([
			page.waitForURL(
				(url) =>
					url.pathname === "/blog/search/" &&
					url.searchParams.get("searched") === "htmx",
			),
			searchbox.press("Enter"),
		]);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		const htmx = await results(page);
		assert.equal(
			await page.getByRole("heading", { level: 1 }).textContent(),
			"You searched for 'htmx'",
		);
		assert.notDeepEqual(htmx.hrefs, django.hrefs);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("a reader whose search index fails to load is told so, can browse the archive, and Try again recovers", async () => {
	const context = await browser.newContext();
	try {
		// The first index request fails; later ones reach the server.
		let requests = 0;
		await context.route(`${site.origin}${INDEX}`, (route) => {
			requests += 1;
			return requests === 1
				? route.fulfill({ status: 500, body: "unavailable" })
				: route.continue();
		});
		const { page, errors } = await openSearch(context, "django");
		await page.getByText("Search couldn't load.").waitFor();
		assert.equal(
			await page
				.getByRole("link", { name: "browse all posts" })
				.getAttribute("href"),
			"/blog/all-posts/",
		);
		assert.equal(await page.locator(".post-card").count(), 0);
		await page.getByRole("button", { name: "Try again" }).click();
		const recovered = await results(page);
		assert.equal(recovered.count, `${recovered.hrefs.length} results`);
		assert.equal(requests, 2, "one failed index request, then one retry");
		assert.equal(await page.getByText("Search couldn't load.").count(), 0);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
