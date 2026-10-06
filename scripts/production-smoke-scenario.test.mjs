import assert from "node:assert/strict";
import it from "node:test";
import { chromium } from "playwright";
import {
	productionUrl,
	smoke,
	verifyFeeds,
} from "./production-smoke-scenario.mjs";

const EXPECTED_FAILURE = /Timeout/u;
const MISSING_BODY = /article body is not empty/u;
const MISSING_RESULT = /search lists the article just read/u;
const NOT_XML = /XML feed type/u;
// Long enough for a loaded CI machine; the failures below are assertions,
// not timeouts, so it never slows a test down.
const STUB_TIMEOUT_MS = 5000;

// A stand-in for every page the scenario visits, each with only the markup
// it reads. The menus open with inline scripts, as the hydrated islands do.
const PORTFOLIO_MENU =
	// biome-ignore lint/security/noSecrets: stub HTML markup, not credential material.
	'<button aria-label="Toggle mobile menu" aria-expanded="false" onclick="const menu=document.getElementById(\'mobile-menu\');menu.hidden=!menu.hidden;this.setAttribute(\'aria-expanded\',String(!menu.hidden))">Menu</button><nav id="mobile-menu" aria-label="Mobile navigation" hidden><a href="/about/" aria-label="About John Solly">About</a><a href="/contact/" aria-label="Contact John Solly">Contact</a><a href="/blog/" aria-label="Blog by John Solly">Blog</a><a href="/recipes/" aria-label="Recipes by John Solly">Recipes</a></nav>';
const BLOG_MENU =
	'<button aria-label="Menu" onclick="const panel=document.getElementById(\'blog-menu\');panel.hidden=!panel.hidden">Menu</button><nav id="blog-menu" aria-label="Main navigation" hidden><form action="/blog/search/" method="get"><label for="site-search">Search</label><input id="site-search" type="search" name="searched"></form></nav>';
const POST_CARD =
	'<div class="post-list"><a class="post-card-link" href="/blog/example/">Example post</a></div>';
const SITE = {
	"/": `<h1>Hi, I'm John Solly.</h1>${PORTFOLIO_MENU}`,
	"/about/": `<h1>John Solly</h1>${PORTFOLIO_MENU}`,
	"/contact/": `<h1>Contact</h1>${PORTFOLIO_MENU}`,
	"/blog/": `${BLOG_MENU}<h1>Latest Posts!</h1>${POST_CARD}`,
	"/blog/example/": `${BLOG_MENU}<article><h1>Example post<a href="#example-post">#</a></h1><div class="post-text">Public article content</div></article>`,
	"/blog/search/": `${BLOG_MENU}<h1>You searched for 'Example post'</h1><div role="status">1 result</div>${POST_CARD}`,
	"/recipes/":
		'<section class="meal-library" data-hydrated="true"><article class="recipe-card">Lemon salmon</article></section>',
};
const FEED_DOCUMENTS = {
	"/blog/rss.xml": ["application/rss+xml; charset=utf-8", "<rss></rss>"],
	"/blog/atom.xml": ["application/atom+xml; charset=utf-8", "<feed></feed>"],
};

// The runner's verifyHttp for the stub site: records each URL and answers
// without the network, the feeds with their XML.
function stubVerifyHttp(checked) {
	return (url) => {
		checked.push(url);
		const [type, body] = FEED_DOCUMENTS[new URL(url).pathname] ?? [
			"text/html",
			"<h1>Page</h1>",
		];
		const response = new Response(body, { headers: { "content-type": type } });
		Object.defineProperty(response, "url", { value: url });
		return response;
	};
}

// context.request for the stub site, which never reaches the network:
// Markdown negotiation on /about/, HTML only on the post.
function stubRequest(requested) {
	return {
		get: (url, { headers }) => {
			requested.push({ url, accept: headers.accept });
			const markdown = new URL(url).pathname === "/about/";
			return {
				status: () => 200,
				headers: () =>
					markdown
						? { "content-type": "text/markdown; charset=utf-8", vary: "Accept" }
						: { "content-type": "text/html; charset=utf-8" },
				text: async () => (markdown ? "# John Solly\n" : "<h1>Page</h1>"),
			};
		},
	};
}

// Runs the scenario against the stub site, with `overrides` replacing pages.
// Every browser request must be a GET. Resolves to what it checked.
async function runAgainstStubs(overrides = {}) {
	const pages = { ...SITE, ...overrides };
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		const methods = new Set();
		await context.route("**/*", (route) => {
			const request = route.request();
			methods.add(request.method());
			const body = pages[new URL(request.url()).pathname];
			return body
				? route.fulfill({ contentType: "text/html", body })
				: route.fulfill({ status: 404, contentType: "text/plain", body: "" });
		});
		const page = await context.newPage();
		page.setDefaultTimeout(STUB_TIMEOUT_MS);
		await page.goto(productionUrl);
		const checked = [];
		const requested = [];
		await smoke({
			page,
			context: { request: stubRequest(requested) },
			verifyHttp: stubVerifyHttp(checked),
		});
		return { methods, checked, requested };
	} finally {
		await browser.close();
	}
}

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

it("an article page with no article body fails the public reading smoke", async () => {
	await assert.rejects(
		runAgainstStubs({
			"/blog/example/": `${BLOG_MENU}<article><h1>Example post</h1><div class="post-text"></div></article>`,
		}),
		MISSING_BODY,
	);
});

it("public article, GET search, feeds and mobile navigation are read-only", async () => {
	const { methods, checked, requested } = await runAgainstStubs();
	assert.deepEqual([...methods], ["GET"]);
	assert.deepEqual(checked, [
		`${productionUrl}/about/`,
		`${productionUrl}/contact/`,
		`${productionUrl}/blog/example/`,
		`${productionUrl}/blog/search/?searched=Example+post`,
		`${productionUrl}/blog/rss.xml`,
		`${productionUrl}/blog/atom.xml`,
		`${productionUrl}/recipes/`,
	]);
	assert.deepEqual(requested, [
		{ url: `${productionUrl}/about/`, accept: "text/markdown" },
		{ url: `${productionUrl}/blog/example/`, accept: "text/markdown" },
	]);
});

it("a search that does not list the article just read fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			"/blog/search/": `${BLOG_MENU}<h1>You searched for 'Example post'</h1><div role="status">1 result</div><div class="post-list"><a class="post-card-link" href="/blog/other/">Other post</a></div>`,
		}),
		MISSING_RESULT,
	);
});

it("feed smoke rejects a successful HTML response in place of XML", async () => {
	await assert.rejects(
		verifyFeeds({
			verifyHttp: async () =>
				new Response("<html></html>", {
					headers: { "content-type": "text/html" },
				}),
		}),
		NOT_XML,
	);
});
