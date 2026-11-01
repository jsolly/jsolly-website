import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { JOB_TITLE } from "../../src/content/constants.js";
import { collectErrors, serveStatic, stubOffOrigin } from "./pages.mjs";

// Hold island modules until every server-rendered node has been captured.
// Hydration must retain the existing DOM, including recipe controls and tables.
const SHIPPED = "dist";
const ISLAND_MODULE = /\s(?:component|renderer)-url="(?<url>[^"]+)"/gu;
const GEO_DEV_LINK = /Geo Dev/u;
const OLD_BLOG_HOST = /blogthedata\.com/u;
let browser;
const servers = [];
const sites = {};

async function listen(name, root) {
	const site = await serveStatic(root);
	servers.push(site);
	sites[name] = { root, origin: site.origin };
}

// The pathnames of the island component and renderer modules on a page.
async function islandModules(root, path) {
	const html = await fs.readFile(join(root, path, "index.html"), "utf8");
	return new Set(
		[...html.matchAll(ISLAND_MODULE)].map((match) => match.groups.url),
	);
}

// `stable`, when given, selects island elements that must survive hydration
// even on a page that replaces part of its server render.
async function nodeReuse({ root, origin }, path, stable = ":not(*)") {
	const held = await islandModules(root, path);
	const intercepted = new Set();
	let release;
	const released = new Promise((resolveRelease) => {
		release = resolveRelease;
	});
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		// Keep hydration checks independent of external post images.
		await stubOffOrigin(context, origin);
		await context.route(
			(url) => held.has(url.pathname),
			async (route) => {
				intercepted.add(new URL(route.request().url()).pathname);
				await released;
				await route.continue();
			},
		);
		const page = await context.newPage();
		const errors = collectErrors(page);
		await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
		const { total, stableTotal } = await page.evaluate((selector) => {
			window.__ssrIslandNodes = [
				...document.querySelectorAll("astro-island[ssr] *"),
			];
			window.__stableNodes = [
				...document.querySelectorAll(`astro-island[ssr] :is(${selector})`),
			];
			return {
				total: window.__ssrIslandNodes.length,
				stableTotal: window.__stableNodes.length,
			};
		}, stable);
		release();
		// Recipe summaries continue loading after hydration. Observe the actual
		// hydration/preferences boundary rather than global network quiescence.
		await page.waitForFunction(
			() =>
				!document.querySelector("astro-island[ssr]") &&
				!document.querySelector('[data-preferences-ready="false"]'),
		);
		const { reused, stableReused } = await page.evaluate(() => ({
			reused: window.__ssrIslandNodes.filter((node) => node.isConnected).length,
			stableReused: window.__stableNodes.filter((node) => node.isConnected)
				.length,
		}));
		return {
			total,
			reused,
			stable: { reused: stableReused, total: stableTotal },
			errors,
			held,
			intercepted,
		};
	} finally {
		release();
		await context.close();
	}
}

before(async () => {
	await listen("shipped", SHIPPED);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await Promise.all(servers.map((site) => site.close()));
});

// Every island on these pages must reuse every server-rendered node.
const FULL_REUSE_PAGES = [
	"/",
	"/about/",
	"/blog/",
	"/blog/works-cited/",
	"/blog/search/",
];
// Greek turkey patties includes the family-side select. Its title and flow
// table must survive hydration, as must the collection controls and initial cards.
const COLLECTION_STABLE =
	".library-controls *, .recipe-card:nth-child(-n+24), .recipe-card:nth-child(-n+24) *";
const STABLE_REUSE_PAGES = [
	// Collections remove later cards after hydration for progressive loading.
	// Controls and the first 24 cards must still hydrate in place.
	{ path: "/recipes/meals/", stable: COLLECTION_STABLE },
	{ path: "/recipes/", stable: COLLECTION_STABLE },
	{ path: "/recipes/greek-turkey-patties/", stable: "h1, .trn-view table" },
];

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

for (const { path, stable } of [
	...FULL_REUSE_PAGES.map((route) => ({ path: route })),
	...STABLE_REUSE_PAGES,
]) {
	it(`a visitor opening ${path} keeps its server-rendered UI through hydration`, async () => {
		const report = await nodeReuse(sites.shipped, path, stable);
		assert.ok(report.held.size > 0, `${path}: island modules exist`);
		assert.ok(
			sameSet(report.intercepted, report.held),
			`${path}: modules were held until the SSR snapshot`,
		);
		assert.deepEqual(report.errors, [], `${path}: no browser errors`);
		assert.ok(report.total > 0, `${path}: island nodes are server-rendered`);
		const retained = stable ? report.stable : report;
		assert.ok(
			retained.total > 0,
			`${path}: expected nodes are server-rendered`,
		);
		assert.equal(
			retained.reused,
			retained.total,
			`${path}: expected server-rendered nodes survive hydration`,
		);
	});
}

it("a phone blog visitor uses shared navigation and the hydrated category disclosure", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	try {
		await stubOffOrigin(context, sites.shipped.origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		await page.goto(`${sites.shipped.origin}/blog/works-cited/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		const menu = page.getByRole("button", { name: "Toggle mobile menu" });
		await menu.click();
		await page
			.getByRole("navigation", { name: "Mobile navigation" })
			.waitFor({ state: "visible" });
		await menu.press("Escape");
		assert.equal(await menu.getAttribute("aria-expanded"), "false");
		const toggle = page.getByRole("button", {
			name: "Categories",
			exact: true,
		});
		assert.equal(await toggle.getAttribute("aria-expanded"), "false");
		await toggle.focus();
		await toggle.press("Enter");
		await page.waitForFunction(
			() =>
				document
					.querySelector(".category-toggle")
					?.getAttribute("aria-expanded") === "true",
		);
		const category = page
			.getByRole("navigation", { name: "Blog navigation" })
			.getByRole("link", { name: GEO_DEV_LINK });
		await category.waitFor({ state: "visible" });
		for (const width of [320, 390]) {
			// biome-ignore lint/performance/noAwaitInLoops: Each viewport must be applied before measuring this shared page.
			await page.setViewportSize({ width, height: 844 });
			const bounds = await page.locator(".category-options").boundingBox();
			assert.ok(
				bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
				"every category stays inside the viewport when the toolbar wraps",
			);
		}
		await toggle.press("Tab");
		assert.equal(
			await page.evaluate(
				() => document.activeElement?.closest(".category-options") !== null,
			),
			true,
			"Tab reaches category links",
		);
		await toggle.click();
		await category.waitFor({ state: "hidden" });
		await page.goto(
			`${sites.shipped.origin}/blog/Planetary-Computer-STAC-Landsat-data/`,
		);
		assert.ok(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
			"the preserved long image credit must wrap within the mobile page",
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("a desktop blog visitor reaches the archive through the section toolbar and shared primary navigation", async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	try {
		await stubOffOrigin(context, sites.shipped.origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		await page.goto(`${sites.shipped.origin}/blog/works-cited/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(
			await page
				.getByRole("button", { name: "Toggle mobile menu" })
				.isVisible(),
			false,
		);
		assert.equal(
			await page
				.getByRole("navigation", { name: "Primary navigation" })
				.isVisible(),
			true,
		);
		await Promise.all([
			page.waitForURL("**/blog/all-posts/"),
			page
				.getByRole("navigation", { name: "Blog navigation" })
				.getByRole("link", { name: "All posts", exact: true })
				.click(),
		]);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("a phone visitor without JavaScript can use shared links, categories and GET search", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		javaScriptEnabled: false,
	});
	try {
		await stubOffOrigin(context, sites.shipped.origin);
		const page = await context.newPage();
		await page.goto(`${sites.shipped.origin}/blog/works-cited/`);
		assert.equal(
			await page
				.getByRole("button", { name: "Toggle mobile menu" })
				.isVisible(),
			false,
		);
		assert.equal(
			await page
				.getByRole("navigation", { name: "Mobile navigation" })
				.getByRole("link", { name: "My Recipes" })
				.isVisible(),
			true,
		);
		const toolbar = page.getByRole("navigation", { name: "Blog navigation" });
		const category = toolbar.getByRole("link", { name: GEO_DEV_LINK });
		assert.equal(await category.isVisible(), true);
		await Promise.all([
			page.waitForURL("**/blog/category/Geodev/"),
			category.click(),
		]);
		await page.getByLabel("Search posts", { exact: true }).fill("django");
		await Promise.all([
			page.waitForURL("**/blog/search/?searched=django"),
			page.getByRole("button", { name: "Search", exact: true }).click(),
		]);
	} finally {
		await context.close();
	}
});

// The portfolio's primary links as each landmark renders them: the on-site
// blog and recipes open in the same tab, only the resume opens a new one.
// Landmarks are found by label, not role, because a phone viewport hides the
// desktop Primary navigation.
const SITE_LINKS = [
	{ text: "About", href: "/about/", target: null, rel: null },
	{ text: "Contact", href: "/contact/", target: null, rel: null },
	{ text: "Blog", href: "/blog/", target: null, rel: null },
	{ text: "My Recipes", href: "/recipes/", target: null, rel: null },
	{
		text: "Resume",
		href: "/John-Solly-Resume.pdf",
		target: "_blank",
		rel: "noopener noreferrer",
	},
];

function landmarkLinks(page, name) {
	return page.locator(`nav[aria-label="${name}"] a`).evaluateAll((links) =>
		links.map((link) => ({
			text: link.textContent.trim(),
			href: link.getAttribute("href"),
			target: link.getAttribute("target"),
			rel: link.getAttribute("rel"),
		})),
	);
}

it("A visitor on / reaches the on-site blog and recipes in the same tab and gets the resume in a new tab", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	try {
		await stubOffOrigin(context, sites.shipped.origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		await page.goto(`${sites.shipped.origin}/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		await page.getByRole("button", { name: "Toggle mobile menu" }).click();
		await page
			.getByRole("navigation", { name: "Mobile navigation" })
			.waitFor({ state: "visible" });
		const names = [
			"Primary navigation",
			"Mobile navigation",
			"Footer navigation",
		];
		const landmarks = Object.fromEntries(
			await Promise.all(
				names.map(async (name) => [name, await landmarkLinks(page, name)]),
			),
		);
		assert.deepEqual(landmarks, {
			"Primary navigation": SITE_LINKS,
			"Mobile navigation": SITE_LINKS,
			"Footer navigation": SITE_LINKS,
		});
		const hrefs = await page
			.locator("a[href]")
			.evaluateAll((links) => links.map((link) => link.href));
		assert.deepEqual(
			hrefs.filter((href) => OLD_BLOG_HOST.test(href)),
			[],
			"no link on / points at the old blog host",
		);
		assert.deepEqual(errors, [], "no page errors");
	} finally {
		await context.close();
	}
});

const JSON_LD =
	/<script type="application\/ld\+json">(?<json>[\s\S]*?)<\/script>/u;
const OLD_BIO = /Health-IT/u;

it("A search engine reading the home, about and contact pages gets John's Enterprise Health title and no link to the old blog", async () => {
	const pages = await Promise.all(
		["index.html", "about/index.html", "contact/index.html"].map(
			async (file) => {
				const html = await fs.readFile(join(SHIPPED, file), "utf8");
				const graph = JSON.parse(html.match(JSON_LD).groups.json)["@graph"];
				const person = graph.find((node) => node["@type"] === "Person");
				return {
					file,
					jobTitle: person.jobTitle,
					oldBlogSameAs: graph
						.flatMap((node) => node.sameAs ?? [])
						.filter((url) => OLD_BLOG_HOST.test(url)),
					oldBio: OLD_BIO.test(html),
					oldBlogHost: OLD_BLOG_HOST.test(html),
				};
			},
		),
	);
	assert.deepEqual(
		pages,
		pages.map(({ file }) => ({
			file,
			jobTitle: JOB_TITLE,
			oldBlogSameAs: [],
			oldBio: false,
			oldBlogHost: false,
		})),
	);
});
