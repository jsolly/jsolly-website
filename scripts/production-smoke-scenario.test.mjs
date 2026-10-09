import assert from "node:assert/strict";
import it from "node:test";
import { chromium } from "playwright";
import {
	productionUrl,
	smoke,
	verifyRelease,
} from "./production-smoke-scenario.mjs";

const STALE_RELEASE = /Canonical site must serve the intended release/u;
const MENU_NEVER_OPENS = /Timeout[\s\S]*Mobile navigation/u;
const MISSING_BODY = /article body is not empty/u;
const MISSING_RESULT = /search lists the article just read/u;
const NOT_XML = /blog\/rss\.xml has its XML feed type/u;
const NOT_A_FEED = /blog\/rss\.xml serves a feed document/u;
const NEVER_HYDRATES = /Timeout[\s\S]*data-hydrated=true/u;
const NO_CARDS = /the recipe library shows recipe cards/u;
const POST_NOT_MARKDOWN = /a post serves Markdown when Markdown is asked for/u;
const POST_VARIES = /post Markdown varies on Accept/u;
const ABOUT_DOES_NOT_VARY = /negotiated Markdown varies on Accept/u;
const POST_MISSING = /a post asked for as Markdown answers/u;
const ABOUT_NOT_MARKDOWN = /\/about\/ answers Markdown/u;
const WRONG_MARKDOWN_TITLE =
	/post Markdown retains the selected article title/u;
const WRONG_TITLE = /article title matches the selected post/u;
const OFF_BLOG = /the blog links to a public article/u;
// Long enough for a loaded CI machine; a test that expects a wait to time
// out passes a shorter one.
const STUB_TIMEOUT_MS = 5000;
const SHORT_TIMEOUT_MS = 1000;

// One real-shaped post: its title holds an apostrophe, a colon and an
// ampersand, as published titles do.
const TITLE = "Svelte 5 Search: What's Fast & What Isn't";
const TITLE_HTML = "Svelte 5 Search: What's Fast &amp; What Isn't";
const POST = "/blog/svelte-5-search-whats-fast-and-what-isnt/";
const SEARCH_URL = `${productionUrl}/blog/search/?searched=Svelte+5+Search%3A+What%27s+Fast+%26+What+Isn%27t`;

// A stand-in for every page the scenario visits, each with only the markup
// it reads. The menus open with inline scripts, as the hydrated islands do.
const PORTFOLIO_LINKS =
	'<a href="/about/" aria-label="About John Solly">About</a><a href="/contact/" aria-label="Contact John Solly">Contact</a><a href="/blog/" aria-label="Blog by John Solly">Blog</a><a href="/recipes/" aria-label="Recipes by John Solly">Recipes</a>';
const PORTFOLIO_MENU = `<header><button aria-label="Toggle mobile menu" aria-expanded="false" onclick="const menu = document.getElementById('mobile-menu'); menu.hidden = !menu.hidden; this.setAttribute('aria-expanded', String(!menu.hidden))">Menu</button><nav id="mobile-menu" aria-label="Mobile navigation" hidden>${PORTFOLIO_LINKS}</nav></header>`;
const BLOG_MENU =
	// biome-ignore lint/security/noSecrets: stub HTML markup, not credential material.
	'<header><button aria-label="Menu" onclick="const panel = document.getElementById(\'blog-menu\'); panel.hidden = !panel.hidden">Menu</button><nav id="blog-menu" aria-label="Main navigation" hidden><a href="/blog/all-posts/">All posts</a><form action="/blog/search/" method="get"><label for="site-search">Search</label><input id="site-search" type="search" name="searched"><button type="submit">Search</button></form></nav></header>';
// A feed URL answered with a page instead of the feed.
// biome-ignore lint/security/noSecrets: stub HTML markup, not credential material.
const BLOG_HOME_HTML = "<main><h1>Solly's Blog</h1></main>";
const postCard = (href, title) =>
	`<article class="post-card"><h2><a class="post-card-link" href="${href}">${title}</a></h2><p class="post-meta">5 min read</p></article>`;
const postList = (first) =>
	`<div class="post-list">${first}${postCard("/blog/astro-islands-in-practice/", "Astro Islands in Practice")}</div>`;
const POST_LIST = postList(postCard(POST, TITLE_HTML));
const postPage = (title) =>
	`${BLOG_MENU}<main><article><h1 id="svelte-5-search">${title}<a class="heading-link" href="#svelte-5-search" aria-label="Link to this heading">#</a></h1><div class="article-body post-text"><p>The blog's search runs in the browser over a prebuilt index, so a query never leaves the page.</p><p>Here is what kept it fast as the archive grew, and what did not.</p></div></article></main>`;
const POST_PAGE = postPage(TITLE_HTML);
const recipeCard = (name) =>
	`<article class="recipe-card"><h3>${name}</h3></article>`;
// The recipe landing, its library holding `content` after its controls.
const recipeLibrary = (content) =>
	`<main><h1>Easy Meals &amp; Smoothies</h1><section class="meal-library" data-hydrated="true" aria-label="Easy Meals &amp; Smoothies recipe library"><label for="servings">Servings</label><select id="servings"><option>4</option></select>${content}</section></main>`;
const RELEASE_SHA = "a".repeat(40);
const SITE = {
	"/release.json": {
		type: "application/json",
		body: JSON.stringify({ sha: RELEASE_SHA }),
	},
	"/": `${PORTFOLIO_MENU}<main><h1>Hi, I'm John Solly.</h1></main>`,
	"/about/": `${PORTFOLIO_MENU}<main><h1>John Solly</h1></main>`,
	"/contact/": `${PORTFOLIO_MENU}<main><h1>Contact John</h1></main>`,
	"/blog/": `${BLOG_MENU}<main><h1>Latest Posts!</h1>${POST_LIST}</main>`,
	[POST]: POST_PAGE,
	"/blog/search/": `${BLOG_MENU}<main><h1>You searched for '${TITLE_HTML}'</h1><div role="status"><p>1 result</p></div><div class="post-list">${postCard(POST, TITLE_HTML)}</div></main>`,
	"/blog/rss.xml": {
		type: "application/rss+xml; charset=utf-8",
		body: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Solly's Blog</title><item><title>${TITLE_HTML}</title></item></channel></rss>`,
	},
	"/blog/atom.xml": {
		type: "application/atom+xml; charset=utf-8",
		body: `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Solly's Blog</title><entry><title>${TITLE_HTML}</title></entry></feed>`,
	},
	"/recipes/": recipeLibrary(
		`${recipeCard("Lemon Salmon and Asparagus")}${recipeCard("Shawarma Chicken Bowls")}`,
	),
};
// What the middleware answers when Markdown is asked for: /about/ has a
// Markdown variant; published posts also vary on Accept.
const MARKDOWN = {
	"/about/": {
		type: "text/markdown; charset=utf-8",
		vary: "Accept",
		body: "# John Solly\n\nCTO of Enterprise Health at Leidos Digital.\n",
	},
	[POST]: {
		type: "text/markdown; charset=utf-8",
		vary: "Accept-Encoding, Accept",
		body: `---\ntitle: ${JSON.stringify(TITLE)}\n---\n\n# ${TITLE}\n\nThe blog article.\n`,
	},
};

const asDocument = (page) =>
	typeof page === "string" ? { type: "text/html", body: page } : page;

// The runner's verifyHttp for the stub site: records each URL and answers
// without the network.
function stubVerifyHttp(pages, checked) {
	return (url) => {
		checked.push(url);
		const page = pages[new URL(url).pathname];
		if (!page) throw new Error(`HTTP 404: ${url}`);
		const { type, body } = asDocument(page);
		const response = new Response(body, { headers: { "content-type": type } });
		Object.defineProperty(response, "url", { value: url });
		return response;
	};
}

// context.request for the stub site, which never reaches the network.
function stubRequest(answers, requested) {
	return {
		get: (url, { headers }) => {
			requested.push({ url, accept: headers.accept });
			const answer = answers[new URL(url).pathname];
			if (!answer) throw new Error(`Unexpected request: ${url}`);
			return {
				status: () => answer.status ?? 200,
				headers: () => ({ "content-type": answer.type, vary: answer.vary }),
				text: () => Promise.resolve(answer.body),
			};
		},
	};
}

// Runs the scenario against the stub site, with `pages` and `markdown`
// replacing its pages and Markdown answers and `timeout` as the page's
// default. Records every browser request's method. Resolves to what it checked.
async function runAgainstStubs({
	pages = {},
	markdown = {},
	timeout = STUB_TIMEOUT_MS,
} = {}) {
	const site = { ...SITE, ...pages };
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		const methods = new Set();
		await context.route("**/*", (route) => {
			const request = route.request();
			methods.add(request.method());
			const page = site[new URL(request.url()).pathname];
			if (!page) {
				return route.fulfill({ status: 404, contentType: "text/plain" });
			}
			const { type, body } = asDocument(page);
			return route.fulfill({ contentType: type, body });
		});
		const page = await context.newPage();
		page.setDefaultTimeout(timeout);
		await page.goto(productionUrl);
		const checked = [];
		const requested = [];
		await smoke({
			releaseSha: RELEASE_SHA,
			page,
			context: {
				request: stubRequest({ ...MARKDOWN, ...markdown }, requested),
			},
			verifyHttp: stubVerifyHttp(site, checked),
		});
		return { methods, checked, requested };
	} finally {
		await browser.close();
	}
}

it("mobile navigation without its script fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				"/": `<header><button aria-label="Toggle mobile menu" aria-expanded="false">Menu</button><nav aria-label="Mobile navigation" hidden>${PORTFOLIO_LINKS}</nav></header><main><h1>Hi, I'm John Solly.</h1></main>`,
			},
			timeout: SHORT_TIMEOUT_MS,
		}),
		MENU_NEVER_OPENS,
	);
});

it("an article page with no article body fails the public reading smoke", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				[POST]: `${BLOG_MENU}<main><article><h1>${TITLE_HTML}</h1><div class="article-body post-text"></div></article></main>`,
			},
		}),
		MISSING_BODY,
	);
});

it("public article, GET search, feeds and mobile navigation are read-only", async () => {
	const { methods, checked, requested } = await runAgainstStubs();
	assert.deepEqual([...methods], ["GET"]);
	assert.deepEqual(checked, [
		`${productionUrl}/release.json`,
		`${productionUrl}/about/`,
		`${productionUrl}/contact/`,
		`${productionUrl}${POST}`,
		SEARCH_URL,
		`${productionUrl}/blog/rss.xml`,
		`${productionUrl}/blog/atom.xml`,
		`${productionUrl}/recipes/`,
	]);
	assert.deepEqual(requested, [
		{ url: `${productionUrl}/about/`, accept: "text/markdown" },
		{ url: `${productionUrl}${POST}`, accept: "text/markdown" },
	]);
});

it("a search that does not list the article just read fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				"/blog/search/": `${BLOG_MENU}<main><h1>You searched for '${TITLE_HTML}'</h1><div role="status"><p>1 result</p></div><div class="post-list">${postCard("/blog/astro-islands-in-practice/", "Astro Islands in Practice")}</div></main>`,
			},
		}),
		MISSING_RESULT,
	);
});

it("feed smoke rejects a successful HTML response in place of XML", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: { "/blog/rss.xml": BLOG_HOME_HTML },
		}),
		NOT_XML,
	);
});

it("a feed with its XML type but an HTML body fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				"/blog/rss.xml": {
					type: "application/rss+xml; charset=utf-8",
					body: `<!doctype html>${BLOG_HOME_HTML}`,
				},
			},
		}),
		NOT_A_FEED,
	);
});

it("a recipe library that never hydrates fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				"/recipes/": SITE["/recipes/"].replace(
					'data-hydrated="true"',
					'data-hydrated="false"',
				),
			},
			timeout: SHORT_TIMEOUT_MS,
		}),
		NEVER_HYDRATES,
	);
});

it("a recipe library with no recipe cards fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				"/recipes/": recipeLibrary(
					'<p class="no-results" role="status">No recipes match these appliances and filters.</p>',
				),
			},
		}),
		NO_CARDS,
	);
});

it("a post that answers HTML fails the Markdown check", async () => {
	await assert.rejects(
		runAgainstStubs({
			markdown: {
				[POST]: {
					type: "text/html; charset=utf-8",
					vary: "Accept",
					body: `# ${TITLE}\n`,
				},
			},
		}),
		POST_NOT_MARKDOWN,
	);
});

it("a post whose Markdown omits Vary Accept fails the negotiation check", async () => {
	await assert.rejects(
		runAgainstStubs({
			markdown: {
				[POST]: {
					type: "text/markdown; charset=utf-8",
					vary: "Accept-Encoding",
					body: POST_PAGE,
				},
			},
		}),
		POST_VARIES,
	);
});

it("Markdown on /about/ that varies only on Accept-Encoding fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			markdown: {
				"/about/": { ...MARKDOWN["/about/"], vary: "Accept-Encoding" },
			},
		}),
		ABOUT_DOES_NOT_VARY,
	);
});

it("a post that is missing when Markdown is asked for fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			markdown: {
				[POST]: {
					status: 404,
					type: "text/markdown; charset=utf-8",
					vary: "Accept",
					body: "# Not found\n\nThis path does not exist on jsolly.com.\n",
				},
			},
		}),
		POST_MISSING,
	);
});

it("/about/ that answers HTML when Markdown is asked for fails", async () => {
	await assert.rejects(
		runAgainstStubs({
			markdown: {
				"/about/": {
					type: "text/html; charset=utf-8",
					vary: "Accept",
					body: SITE["/about/"],
				},
			},
		}),
		ABOUT_NOT_MARKDOWN,
	);
});

it("a post page headed with another post's title fails the title match", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: { [POST]: postPage("Astro Islands in Practice") },
		}),
		WRONG_TITLE,
	);
});

it("a first blog card that links off /blog/ fails the public-article check", async () => {
	await assert.rejects(
		runAgainstStubs({
			pages: {
				"/blog/": `${BLOG_MENU}<main><h1>Latest Posts!</h1>${postList(postCard("/recipes/lemon-salmon-and-asparagus/", "Lemon Salmon and Asparagus"))}</main>`,
			},
		}),
		OFF_BLOG,
	);
});

it("the intended release identity passes before public reading", async () => {
	const checked = [];
	await verifyRelease({
		releaseSha: RELEASE_SHA,
		verifyHttp: stubVerifyHttp(SITE, checked),
	});
	assert.deepEqual(checked, [`${productionUrl}/release.json`]);
});

it("a stale live release stops before any public browser interaction", async () => {
	const checked = [];
	await assert.rejects(
		smoke({
			releaseSha: RELEASE_SHA,
			verifyHttp: stubVerifyHttp(
				{
					"/release.json": {
						type: "application/json",
						body: JSON.stringify({
							sha: "b".repeat(40),
						}),
					},
				},
				checked,
			),
			page: null,
			context: null,
		}),
		STALE_RELEASE,
	);
	assert.deepEqual(checked, [`${productionUrl}/release.json`]);
});

it("missing or malformed live release identity cannot pass the smoke", async () => {
	await Promise.all(
		["{}", "null", "not JSON", JSON.stringify({ sha: "short" })].map((body) =>
			assert.rejects(
				verifyRelease({
					releaseSha: RELEASE_SHA,
					verifyHttp: async () => new Response(body),
				}),
			),
		),
	);
});

it("a Markdown response identifying another article fails even when its body mentions the selected title", async () => {
	await assert.rejects(
		runAgainstStubs({
			markdown: {
				[POST]: {
					...MARKDOWN[POST],
					body: `---\ntitle: Another post\n---\n\n# Another post\n\n${TITLE}\n`,
				},
			},
		}),
		WRONG_MARKDOWN_TITLE,
	);
});
