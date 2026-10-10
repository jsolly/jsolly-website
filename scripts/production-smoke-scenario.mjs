// biome-ignore-all lint/suspicious/noMisplacedAssertion: This exported scenario is executed by the production smoke runner.
import assert from "node:assert/strict";
import { parseFrontmatter } from "astro/markdown";

// The production smoke, read-only (GET only) at a phone width, run by the
// fleet runner scripts/production-smoke.mjs, which blocks service workers:
// 1. the portfolio's mobile menu to About and Contact;
// 2. Markdown negotiation on /about/;
// 3. the mobile menu's Blog link, and the first post on /blog/;
// 4. the blog's GET search for that post's title, which must list it;
// 5. the RSS and Atom feeds with their XML Content-Types;
// 6. the post asked for as Markdown answers Markdown with Vary: Accept (J11);
// 7. the mobile menu's Recipes link, and the /recipes/ library hydrating.
// A separate fresh context then verifies the recipe worker's activation and page control.
export const serviceWorker = {
	page: "/recipes/",
	scope: "/recipes/",
	script: "/recipes/service-worker.js",
};

const FULL_SHA = /^[a-f0-9]{40}$/u;

const CONTACT_HEADING = /Contact/iu;
const MARKDOWN_TYPE = /text\/markdown/u;
const ABOUT_HEADING = /^# John Solly/mu;
const POST_PATH = /^\/blog\/[^/]+\/$/u;
const RESULT_COUNT = /^\d+ results?$/u;
// The feeds and the Content-Type vercel.json gives each (the static build
// cannot), with the root element each document must open.
const FEEDS = [
	["/blog/rss.xml", "application/rss+xml", "<rss"],
	["/blog/atom.xml", "application/atom+xml", "<feed"],
];

export const productionUrl = "https://www.jsolly.com";

// Whether a Vary header names Accept itself (not Accept-Encoding).
const variesOnAccept = (vary) =>
	(vary ?? "")
		.split(",")
		.some((token) => token.trim().toLowerCase() === "accept");

// Leaves the current page with `action` (a click or a goto). The runner fails
// on any same-origin request the browser aborts, and images or the search
// index can still be loading after the load event, so the page settles first.
async function leave(page, action) {
	await page.waitForLoadState("networkidle");
	await action();
}

// Opens the portfolio's mobile menu, follows its link named `name` and waits
// for `path`.
async function followMobileLink(page, name, path) {
	await leave(page, async () => {
		await page.getByRole("button", { name: "Toggle mobile menu" }).click();
		await page
			.getByRole("navigation", { name: "Mobile navigation" })
			.getByRole("link", { name, exact: true })
			.click();
	});
	await page.waitForURL(`${productionUrl}${path}`);
}

// GETs `path` the way an agent asks for Markdown.
async function askForMarkdown(context, path) {
	const response = await context.request.get(`${productionUrl}${path}`, {
		headers: { accept: "text/markdown" },
	});
	const headers = response.headers();
	return {
		status: response.status(),
		type: headers["content-type"] ?? "",
		variesOnAccept: variesOnAccept(headers.vary),
		body: await response.text(),
	};
}

async function browsePortfolio({ page, verifyHttp }) {
	await page
		.getByRole("heading", { name: "Hi, I'm John Solly.", exact: true })
		.waitFor();
	await page.setViewportSize({ width: 390, height: 844 });
	const toggle = page.getByRole("button", { name: "Toggle mobile menu" });
	const menu = page.getByRole("navigation", { name: "Mobile navigation" });
	await toggle.waitFor();
	assert.equal(
		await toggle.getAttribute("aria-expanded"),
		"false",
		"mobile menu starts closed",
	);
	await toggle.click();
	await menu.waitFor({ state: "visible" });
	assert.equal(
		await toggle.getAttribute("aria-expanded"),
		"true",
		"mobile menu announces expansion",
	);
	await leave(page, () =>
		menu.getByRole("link", { name: "About John Solly", exact: true }).click(),
	);
	await page.waitForURL(`${productionUrl}/about/`);
	await page
		.getByRole("heading", { name: "John Solly", exact: true })
		.waitFor();
	await verifyHttp(page.url());
	await followMobileLink(page, "Contact John Solly", "/contact/");
	assert.match(
		await page.locator("h1").textContent(),
		CONTACT_HEADING,
		"contact page renders after mobile navigation",
	);
	await verifyHttp(page.url());
}

async function checkMarkdownNegotiation(context) {
	const about = await askForMarkdown(context, "/about/");
	assert.equal(about.status, 200, "Markdown negotiation succeeds");
	assert.match(about.type, MARKDOWN_TYPE, "/about/ answers Markdown");
	assert.ok(about.variesOnAccept, "negotiated Markdown varies on Accept");
	assert.match(about.body, ABOUT_HEADING);
}

// Follows the mobile menu's Blog link, opens the first post card and checks
// the article it reaches. Resolves to the post's title and path.
async function readFirstPost({ page, verifyHttp }) {
	await followMobileLink(page, "Blog by John Solly", "/blog/");
	await page
		.getByRole("heading", { name: "Latest Posts!", exact: true })
		.waitFor();
	const card = page.locator("a.post-card-link").first();
	const title = (await card.textContent()).trim();
	const postPath = await card.getAttribute("href");
	assert.match(postPath, POST_PATH, "the blog links to a public article");
	await leave(page, () => card.click());
	await page.waitForURL(`${productionUrl}${postPath}`);
	assert.equal(
		// The h1 also holds its "#" heading link.
		await page.locator("article h1").evaluate((heading) =>
			[...heading.childNodes]
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.textContent)
				.join("")
				.trim(),
		),
		title,
		"article title matches the selected post",
	);
	assert.ok(
		(await page.locator("article .post-text").textContent()).trim().length > 0,
		"article body is not empty",
	);
	await verifyHttp(page.url());
	return { title, postPath };
}

// Searches for `title` with the blog toolbar search (a GET form), and checks
// that the search page, which fetches /blog/search-index.json, lists the post.
async function searchFor({ page, verifyHttp, title, postPath }) {
	const search = page
		.getByRole("navigation", { name: "Blog navigation" })
		.getByRole("searchbox", { name: "Search posts", exact: true });
	await search.fill(title);
	await leave(page, () => search.press("Enter"));
	await page.waitForURL(
		(url) =>
			url.pathname === "/blog/search/" &&
			url.searchParams.get("searched") === title,
	);
	await page
		.getByRole("heading", { name: "Search posts", exact: true })
		.waitFor();
	await page.getByRole("status").filter({ hasText: RESULT_COUNT }).waitFor();
	assert.ok(
		(
			await page
				.locator(".post-list a.post-card-link")
				.evaluateAll((links) => links.map((link) => link.getAttribute("href")))
		).includes(postPath),
		"search lists the article just read",
	);
	await verifyHttp(page.url());
}

async function verifyFeeds({ verifyHttp }) {
	for (const [path, type, root] of FEEDS) {
		// biome-ignore lint/performance/noAwaitInLoops: one feed request at a time keeps the receipt in order.
		const response = await verifyHttp(`${productionUrl}${path}`);
		assert.ok(
			response.headers.get("content-type")?.startsWith(type),
			`${path} has its XML feed type`,
		);
		assert.ok(
			(await response.text()).includes(root),
			`${path} serves a feed document`,
		);
	}
}

// Published blog Markdown must negotiate to the selected article, with Vary: Accept.
async function checkPostMarkdown(context, path, title) {
	const post = await askForMarkdown(context, path);
	assert.equal(post.status, 200, "a post asked for as Markdown answers");
	assert.match(
		post.type,
		MARKDOWN_TYPE,
		"a post serves Markdown when Markdown is asked for",
	);
	assert.ok(post.variesOnAccept, "post Markdown varies on Accept");
	assert.equal(
		parseFrontmatter(post.body).frontmatter.title,
		title,
		"post Markdown retains the selected article title",
	);
}

// Goes home and follows the mobile menu's Recipes link; the library hydrates,
// though the runner blocks service workers.
async function openRecipes({ page, verifyHttp }) {
	await leave(page, () => page.goto(productionUrl));
	await followMobileLink(page, "My Recipes", "/recipes/");
	const library = page.locator(".meal-library[data-hydrated=true]");
	await library.waitFor();
	assert.ok(
		(await library.locator(".recipe-card:visible").count()) > 0,
		"the recipe library shows recipe cards",
	);
	await verifyHttp(page.url());
}

export async function verifyRelease({ verifyHttp, releaseSha }) {
	assert.match(releaseSha ?? "", FULL_SHA, "Smoke requires a full release SHA");
	const response = await verifyHttp(`${productionUrl}/release.json`);
	assert.equal(
		(await response.json())?.sha,
		releaseSha,
		"Canonical site must serve the intended release",
	);
}

export async function smoke({
	page,
	context,
	verifyHttp,
	releaseSha = process.env.PRODUCTION_SMOKE_RELEASE_SHA,
}) {
	await verifyRelease({ verifyHttp, releaseSha });
	await browsePortfolio({ page, verifyHttp });
	await checkMarkdownNegotiation(context);
	const { title, postPath } = await readFirstPost({ page, verifyHttp });
	await searchFor({ page, verifyHttp, title, postPath });
	await verifyFeeds({ verifyHttp });
	await checkPostMarkdown(context, postPath, title);
	await openRecipes({ page, verifyHttp });
}
