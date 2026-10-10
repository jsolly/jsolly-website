import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import {
	categorySlugs,
	collectErrors,
	publishedPosts,
	serveStatic,
	stubOffOrigin,
} from "./pages.mjs";

let browser;
let site;
const posts = await publishedPosts();
const paths = [
	"/",
	"/about/",
	"/contact/",
	"/privacy/",
	"/terms/",
	"/404.html",
	"/500.html",
	"/blog/",
	"/blog/all-posts/",
	"/blog/works-cited/",
	`/blog/${posts[0].slug}/`,
	...(await categorySlugs().then((slugs) =>
		slugs.map((slug) => `/blog/category/${slug}/`),
	)),
	`/blog/search/?searched=${"a long search phrase ".repeat(12)}`,
	"/recipes/",
	"/recipes/meals/",
	"/recipes/smoothies/",
	"/recipes/greek-turkey-patties/",
	"/recipes/banana-flax-smoothie/",
];
before(async () => {
	browser = await chromium.launch();
	site = await serveStatic("dist");
});
after(async () => {
	await browser?.close();
	await site?.close();
});

// Network gating gives the styled server render an arbitrary time on screen.
// Compare actual geometry and node identity, not a timer or the implementation's
// hydration flags. Search results, pagination and restored preferences have
// their own tests; this covers an ordinary first visit and long search headings.
function firstPaint(page) {
	return page.evaluate(() => {
		const selectors = [
			"#site-header",
			".blog-toolbar",
			"main h1",
			".recipe-detail .servings",
			".recipe-detail .detail-appliances",
			".recipe-detail .trn-view",
			".recipe-detail .nutrition",
			".recipe-detail .recipe-share",
		];
		return {
			boxes: selectors.flatMap((selector) =>
				[...document.querySelectorAll(selector)].map((element) => {
					const { x, y, width, height } = element.getBoundingClientRect();
					return { selector, x, y, width, height };
				}),
			),
			categoriesVisible: Boolean(
				document
					.querySelector(".category-options")
					?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
			),
			mobileMenuVisible: Boolean(
				document
					.querySelector("#mobile-menu")
					?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
			),
			recipes: [...document.querySelectorAll(".recipe-grid .open-button")].map(
				(link) => link.getAttribute("href"),
			),
			disclosures: [
				...document.querySelectorAll(
					".recipe-detail [data-collapsible-trigger]",
				),
			].map((trigger) => trigger.getAttribute("aria-expanded")),
		};
	});
}

async function auditPath(path, width, colorScheme) {
	const context = await browser.newContext({
		viewport: { width, height: 900 },
		colorScheme,
		reducedMotion: "reduce",
	});
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	try {
		await stubOffOrigin(context, site.origin);
		await context.route("**/*", async (route) => {
			if (route.request().resourceType() === "script") await gate;
			await route.fallback();
		});
		const page = await context.newPage();
		const errors = collectErrors(page, ["error", "warning"]);
		await page.goto(`${site.origin}${path}`, { waitUntil: "commit" });
		await page.locator("main h1").first().waitFor();
		await page.waitForFunction(() =>
			[...document.querySelectorAll("link")]
				.filter((link) => link.rel === "stylesheet")
				.every((link) => link.sheet),
		);
		await page.evaluate(() => document.fonts.ready);
		const initial = await firstPaint(page);

		await page.evaluate(() => {
			window.initialRecipeControls = [
				...document.querySelectorAll(
					".recipe-detail button, .recipe-detail select",
				),
			];
		});
		release();
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		const hydrated = await firstPaint(page);
		const controlsReady = await page.evaluate(() =>
			window.initialRecipeControls.every(
				(node) => node.isConnected && !node.disabled,
			),
		);
		return { initial, hydrated, controlsReady, errors };
	} finally {
		release();
		await context.close();
	}
}

for (const width of [390, 1280]) {
	for (const colorScheme of ["light", "dark"]) {
		it(`styled first paint stays stable through hydration at ${width}px in ${colorScheme} mode`, {
			timeout: 120_000,
		}, async () => {
			for (const path of paths) {
				// biome-ignore lint/performance/noAwaitInLoops: Limit resource usage while measuring each page independently.
				const { initial, hydrated, controlsReady, errors } = await auditPath(
					path,
					width,
					colorScheme,
				);
				assert.equal(
					initial.categoriesVisible,
					false,
					`${path}: no category flash`,
				);
				assert.equal(
					initial.mobileMenuVisible,
					false,
					`${path}: no mobile menu flash`,
				);
				assert.deepEqual(
					hydrated,
					initial,
					`${path}: visible layout, card order and disclosures stay stable`,
				);
				assert.equal(
					controlsReady,
					true,
					`${path}: existing recipe controls become usable in place`,
				);
				assert.deepEqual(errors, [], path);
			}
		});
	}
}

it("without JavaScript all blog categories stay visible and navigable", async () => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 390, height: 844 },
	});
	try {
		await stubOffOrigin(context, site.origin);
		const page = await context.newPage();
		await page.goto(`${site.origin}/blog/`);
		assert.equal(
			await page
				.getByRole("button", { name: "Categories", exact: true })
				.count(),
			0,
		);
		const categories = page.locator(".category-options a");
		assert.equal(await categories.count(), (await categorySlugs()).length);
		assert.equal(
			await categories.evaluateAll((links) =>
				links.every((link) => link.checkVisibility()),
			),
			true,
		);
		await Promise.all([
			page.waitForURL("**/blog/category/**"),
			categories.first().click(),
		]);
		assert.equal(await page.locator("main h1").count(), 1);
	} finally {
		await context.close();
	}
});
