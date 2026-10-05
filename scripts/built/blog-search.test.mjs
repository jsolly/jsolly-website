import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { postHref } from "../../src/lib/blog/urls.js";
import { publishedPosts, serveStatic, stubOffOrigin } from "./pages.mjs";

// The search page over the built dist/, in Chromium: the island reads
// ?searched=, fetches /blog/search-index.json and shows the matching published
// posts as cards, with the count in a status line apart from the cards; the
// form searches again by GET on /blog/search/; and an index that fails to load
// says so and offers a retry and the archive.
const DIST = "dist";
const INDEX = "/blog/search-index.json";
const RESULT_COUNT = /^\d+ results?$/u;
const DJANGO = /django/iu;
const HTMX = /htmx/iu;
const NO_MATCH = "No articles matched. Try a shorter phrase or another topic.";
const HINT =
	"Search titles and article text. Partial words and small typos work too.";

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

async function openSearch(context, search = "") {
	await stubOffOrigin(context, site.origin);
	const page = await context.newPage();
	page.setDefaultTimeout(5000);
	const errors = [];
	const consoleErrors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	await page.goto(`${site.origin}/blog/search/${search}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	return { page, errors, consoleErrors };
}

function heading(page) {
	return page.getByRole("heading", { level: 1 }).textContent();
}

// The status line's count and the result cards' links, once the count shows.
async function results(page) {
	const status = page.getByRole("status");
	await status.getByText(RESULT_COUNT).waitFor();
	const hrefs = await page
		.locator(".post-card-link")
		.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
	return {
		count: (await status.textContent()).trim(),
		hrefs,
		firstTitle:
			hrefs.length > 0
				? await page.locator(".post-card-link").first().textContent()
				: null,
		cardsInStatus: await status.locator(".post-card").count(),
	};
}

// What results that list only published posts should show: a status line
// counting the cards, and holding no cards itself.
const LISTED = {
	countMatchesCards: true,
	severalPosts: true,
	unpublished: [],
	cardsInStatus: 0,
};

function listing(found) {
	return {
		countMatchesCards: found.count === `${found.hrefs.length} results`,
		severalPosts: found.hrefs.length > 1,
		unpublished: found.hrefs.filter((href) => !publishedHrefs.has(href)),
		cardsInStatus: found.cardsInStatus,
	};
}

it("a reader arriving with ?searched=django sees that query and published django posts, and the form searches again by GET", async () => {
	const context = await browser.newContext();
	try {
		const { page, errors } = await openSearch(context, "?searched=django");
		const django = await results(page);
		assert.equal(await heading(page), "You searched for 'django'");
		const searchbox = page.getByRole("searchbox", { name: "Search articles" });
		assert.equal(await searchbox.inputValue(), "django");
		assert.deepEqual(listing(django), LISTED, "django");
		assert.match(django.firstTitle, DJANGO, "a title match ranks first");

		// Typing filters the cards; the heading keeps naming the submitted query.
		await searchbox.fill("htmx");
		await page.locator(".post-card-link").first().waitFor();
		assert.equal(await heading(page), "You searched for 'django'");
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
		assert.equal(await heading(page), "You searched for 'htmx'");
		assert.deepEqual(listing(htmx), LISTED, "htmx");
		assert.match(htmx.firstTitle, HTMX, "a title match ranks first");
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("a reader whose query matches nothing is told so with no cards", async () => {
	const context = await browser.newContext();
	try {
		const { page, errors } = await openSearch(context, "?searched=zzzznomatch");
		const none = await results(page);
		assert.equal(await heading(page), "You searched for 'zzzznomatch'");
		assert.equal(none.count, "0 results");
		assert.deepEqual(none.hrefs, []);
		assert.equal(await page.getByText(NO_MATCH, { exact: true }).count(), 1);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("a reader opening the bare search page gets the search hint, and without JavaScript the archive link instead of a loading line", async () => {
	const context = await browser.newContext();
	try {
		const { page, errors } = await openSearch(context);
		const status = page.getByRole("status");
		await status.getByText(HINT, { exact: true }).waitFor();
		assert.equal(await heading(page), "Search posts");
		assert.equal(await status.getAttribute("aria-busy"), null);
		assert.equal(await page.locator(".post-card").count(), 0);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
	const noScript = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await noScript.newPage();
		await page.goto(`${site.origin}/blog/search/`);
		assert.equal(
			await page.getByText("Loading search...").isVisible(),
			false,
			"no-script.css hides the loading line",
		);
		assert.equal(
			await page.getByRole("status").getAttribute("aria-busy"),
			null,
			"the status line is not busy without JavaScript",
		);
		assert.equal(
			await page
				.getByRole("link", { name: "Browse all posts" })
				.getAttribute("href"),
			"/blog/all-posts/",
		);
	} finally {
		await noScript.close();
	}
});

it("a reader whose search index fails to load is told so, can browse the archive, and Try again recovers with focus on the status line", async () => {
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
		const { page, errors, consoleErrors } = await openSearch(
			context,
			"?searched=django",
		);
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
		assert.deepEqual(listing(recovered), LISTED, "after Try again");
		assert.equal(requests, 2, "one failed index request, then one retry");
		assert.equal(await page.getByText("Search couldn't load.").count(), 0);
		await page.waitForFunction(
			() => document.activeElement?.getAttribute("role") === "status",
		);
		assert.ok(
			consoleErrors.some((text) =>
				text.includes("Search index failed to load"),
			),
			`the failure is logged (console errors: ${consoleErrors.join(" | ")})`,
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
