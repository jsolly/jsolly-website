import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { postHref } from "../../src/lib/blog/urls.js";
import {
	publishedPosts,
	robotsMeta,
	serveStatic,
	stubOffOrigin,
} from "./pages.mjs";

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
	// Page and console errors stay apart (not collectErrors): the failed-index
	// test expects a logged console error while page errors stay empty.
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

function countLine(count) {
	return `${count} ${count === 1 ? "result" : "results"}`;
}

function cardHrefs(page) {
	return page
		.locator(".post-card-link")
		.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
}

// The status line's count and the result cards' links, once the count shows.
async function results(page) {
	const status = page.getByRole("status");
	await status.getByText(RESULT_COUNT).waitFor();
	const hrefs = await cardHrefs(page);
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
		countMatchesCards: found.count === countLine(found.hrefs.length),
		severalPosts: found.hrefs.length > 1,
		unpublished: found.hrefs.filter((href) => !publishedHrefs.has(href)),
		cardsInStatus: found.cardsInStatus,
	};
}

it("a reader arriving with ?searched=django sees that query and published django posts, typing filters them, and the form searches again by GET", async () => {
	const context = await browser.newContext();
	try {
		const { page, errors } = await openSearch(context, "?searched=django");
		const django = await results(page);
		assert.equal(await heading(page), "Search posts");
		const searchbox = page.getByRole("searchbox", { name: "Search articles" });
		assert.equal(await searchbox.inputValue(), "django");
		assert.deepEqual(listing(django), LISTED, "django");
		assert.match(django.firstTitle, DJANGO, "a title match ranks first");

		// Typing filters the cards and the status line catches up with them;
		// the heading keeps naming the submitted query.
		await searchbox.fill("htmx");
		await page.waitForFunction(
			(pattern) =>
				new RegExp(pattern, "iu").test(
					document.querySelector(".post-card-link")?.textContent ?? "",
				),
			HTMX.source,
		);
		const typed = await cardHrefs(page);
		assert.notDeepEqual(new Set(typed), new Set(django.hrefs));
		await page
			.getByRole("status")
			.getByText(countLine(typed.length), { exact: true })
			.waitFor();
		assert.equal(await heading(page), "Search posts");

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
		assert.equal(await heading(page), "Search posts");
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
		assert.equal(await heading(page), "Search posts");
		assert.equal(none.count, "0 results");
		assert.deepEqual(none.hrefs, []);
		assert.equal(await page.getByText(NO_MATCH, { exact: true }).count(), 1);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("the bare search page is noindex and gives the search hint, and without JavaScript the archive link and no loading line", async () => {
	assert.equal(await robotsMeta("blog/search"), "noindex, follow");
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
		const status = page.getByRole("status");
		assert.equal(
			(await status.textContent()).trim(),
			"",
			"the server render has no loading line",
		);
		assert.equal(
			await status.getAttribute("aria-busy"),
			null,
			"the status line is not busy without JavaScript",
		);
		const archive = page.getByRole("link", { name: "Browse all posts" });
		assert.equal(await archive.isVisible(), true);
		assert.equal(await archive.getAttribute("href"), "/blog/all-posts/");
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
		assert.equal(
			await page.evaluate(() => document.activeElement?.getAttribute("role")),
			"status",
			"focus is on the status line, not the page",
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

it("a stalled search index reaches its deadline, logs failure, and can be retried", async () => {
	const context = await browser.newContext();
	try {
		// Trigger the browser's abort signal explicitly, without a wall-clock sleep.
		await context.addInitScript(() => {
			AbortSignal.timeout = (milliseconds) => {
				window.indexTimeoutMs = milliseconds;
				window.indexDeadline = new AbortController();
				return window.indexDeadline.signal;
			};
		});
		let requests = 0;
		let started;
		const firstRequest = new Promise((resolve) => {
			started = resolve;
		});
		await context.route(`${site.origin}${INDEX}`, (route) => {
			requests += 1;
			if (requests === 1) {
				started();
				return;
			}
			return route.continue();
		});
		const { page, errors, consoleErrors } = await openSearch(
			context,
			"?searched=django",
		);
		await firstRequest;
		assert.equal(
			await page.getByRole("status").getAttribute("aria-busy"),
			"true",
		);
		assert.equal(await page.evaluate(() => window.indexTimeoutMs), 15_000);
		await page.evaluate(() =>
			window.indexDeadline.abort(
				new DOMException("Search index deadline exceeded", "TimeoutError"),
			),
		);
		await page.getByText("Search couldn't load.").waitFor();
		assert.equal(
			await page.getByRole("status").getAttribute("aria-busy"),
			null,
		);
		assert.equal(await page.locator(".post-card").count(), 0);
		assert.ok(
			consoleErrors.some((text) =>
				text.includes("Search index failed to load"),
			),
		);
		await page.getByRole("button", { name: "Try again" }).click();
		assert.deepEqual(listing(await results(page)), LISTED);
		assert.equal(requests, 2);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
