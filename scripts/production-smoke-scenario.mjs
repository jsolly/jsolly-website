// biome-ignore-all lint/suspicious/noMisplacedAssertion: This exported scenario is executed by the production smoke runner.
import assert from "node:assert/strict";

const CONTACT_HEADING = /Contact/iu;
const MARKDOWN_TYPE = /text\/markdown/u;
const HTML_TYPE = /^text\/html/u;
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

// The runner fails on any same-origin request the browser aborts, so a page
// whose images or search index load after the load event settles before the
// scenario leaves it.
const settle = (page) => page.waitForLoadState("networkidle");

// Opens the portfolio's mobile menu and follows its link named `name`.
async function followMobileLink(page, name) {
	await page.getByRole("button", { name: "Toggle mobile menu" }).click();
	await page
		.getByRole("navigation", { name: "Mobile navigation" })
		.getByRole("link", { name, exact: true })
		.click();
}

export async function verifyFeeds({ verifyHttp }) {
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

// From /blog/, opens the first post card and checks the article it reaches.
// Resolves to the post's title and path.
async function readFirstPost({ page, verifyHttp }) {
	await page
		.getByRole("heading", { name: "Latest Posts!", exact: true })
		.waitFor();
	const card = page.locator("a.post-card-link").first();
	const title = (await card.textContent()).trim();
	const postPath = await card.getAttribute("href");
	assert.match(postPath, POST_PATH, "the blog links to a public article");
	await settle(page);
	await card.click();
	await page.waitForURL(new URL(postPath, productionUrl).href);
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

// Searches for `title` with the blog's menu search (a GET form), and checks
// that the search page, which fetches /blog/search-index.json, lists the post.
async function searchFor({ page, verifyHttp, title, postPath }) {
	await settle(page);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	const search = page
		.getByRole("navigation", { name: "Main navigation" })
		.getByRole("searchbox", { name: "Search", exact: true });
	await search.fill(title);
	await search.press("Enter");
	await page.waitForURL(
		(url) =>
			url.pathname === "/blog/search/" &&
			url.searchParams.get("searched") === title,
	);
	await page
		.getByRole("heading", { name: `You searched for '${title}'`, exact: true })
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
	await settle(page);
}

export async function smoke({ page, context, verifyHttp }) {
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
	await menu
		.getByRole("link", { name: "About John Solly", exact: true })
		.click();
	await page.waitForURL(`${productionUrl}/about/`);
	await page
		.getByRole("heading", { name: "John Solly", exact: true })
		.waitFor();
	await verifyHttp(page.url());
	await followMobileLink(page, "Contact John Solly");
	await page.waitForURL(`${productionUrl}/contact/`);
	assert.match(
		await page.locator("h1").textContent(),
		CONTACT_HEADING,
		"contact page renders after mobile navigation",
	);
	await verifyHttp(page.url());
	const markdown = await context.request.get(`${productionUrl}/about/`, {
		headers: { accept: "text/markdown" },
	});
	assert.equal(markdown.status(), 200, "Markdown negotiation succeeds");
	assert.match(markdown.headers()["content-type"] ?? "", MARKDOWN_TYPE);
	assert.ok(
		variesOnAccept(markdown.headers().vary),
		"negotiated Markdown varies on Accept",
	);
	assert.match(await markdown.text(), ABOUT_HEADING);

	// The blog: a post read from /blog/, found again by search, and the feeds.
	await followMobileLink(page, "Blog by John Solly");
	await page.waitForURL(`${productionUrl}/blog/`);
	const { title, postPath } = await readFirstPost({ page, verifyHttp });
	await searchFor({ page, verifyHttp, title, postPath });
	await verifyFeeds({ verifyHttp });
	// Blog pages are HTML only (J11): Markdown asked for still gets the HTML,
	// with no Vary: Accept.
	const post = await context.request.get(`${productionUrl}${postPath}`, {
		headers: { accept: "text/markdown" },
	});
	assert.equal(post.status(), 200, "a post asked for as Markdown answers");
	assert.match(
		post.headers()["content-type"] ?? "",
		HTML_TYPE,
		"a post serves HTML when Markdown is asked for",
	);
	assert.ok(
		!variesOnAccept(post.headers().vary),
		"a post does not vary on Accept",
	);

	// The recipe library hydrates, though the runner blocks service workers.
	await page.goto(productionUrl);
	await followMobileLink(page, "Recipes by John Solly");
	await page.waitForURL(`${productionUrl}/recipes/`);
	const library = page.locator(".meal-library[data-hydrated=true]");
	await library.waitFor();
	assert.ok(
		(await library.locator(".recipe-card:visible").count()) > 0,
		"the recipe library shows recipe cards",
	);
	await verifyHttp(page.url());
}
