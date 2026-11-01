import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { browseResponse } from "../../api/recipe-browse.mjs";
import recipeData from "../../src/components/recipes/recipe-data.server.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";

const mealCount = recipeData.recipes.filter(
	(recipe) => recipe.type === "meal",
).length;
const salmonFishIds = recipeData.recipes
	.filter(
		(recipe) =>
			recipe.type === "meal" &&
			recipe.proteinType === "fish" &&
			recipe.title.toLowerCase().includes("salmon"),
	)
	.map((recipe) => recipe.id)
	.sort();
const ketoSmoothieIds = recipeData.recipes
	.filter(
		(recipe) =>
			recipe.type === "smoothie" && recipe.nutrition.net_carbs_g <= 12.5,
	)
	.map((recipe) => recipe.id)
	.sort();
let server;
let browser;
before(async () => {
	server = await serveStatic("dist");
	browser = await chromium.launch();
});
after(async () => {
	await browser?.close();
	await server?.close();
});
// biome-ignore lint/security/noSecrets: hostile public search fixture
const HOSTILE_QUERY = "<script>alert(1)</script>";
// biome-ignore lint/security/noSecrets: HTML canonical selector
const CANONICAL = 'link[rel="canonical"]';
// biome-ignore lint/security/noSecrets: public shuffle state form field selector
const SHUFFLE_SEED_FIELD = 'input[name="seed"]';
const NO_MATCHES = /No recipes match/u;
async function cardIds(page) {
	const start = new URL(page.url());
	if (start.searchParams.get("shuffle") === "1") {
		start.searchParams.delete("shuffle");
		start.searchParams.set(
			"seed",
			await page.locator(SHUFFLE_SEED_FIELD).inputValue(),
		);
	}
	const ids = [];
	let hasNext;
	do {
		ids.push(
			// biome-ignore lint/performance/noAwaitInLoops: each native page must load before its next link can be followed
			...(await page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId))),
		);
		const next = page.getByRole("link", { name: "Next recipes", exact: true });
		hasNext = (await next.count()) > 0;
		if (!hasNext) break;
		await Promise.all([page.waitForEvent("load"), next.click()]);
	} while (hasNext);
	if (page.url() !== start.href) await page.goto(start.href);
	return ids;
}

function nativeBrowseTest(width) {
	it(`native filters, search and repeated shuffle survive full-page reloads without JS at ${width}px`, async () => {
		const context = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width, height: 900 },
			serviceWorkers: "block",
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(`${server.origin}/recipes/meals/`);
			assert.equal(
				await page.locator(".recipe-card").count(),
				Math.min(6, mealCount),
			);
			await page
				.getByRole("searchbox", { name: "Search recipes" })
				.fill("salmon");
			assert.equal(
				await page
					.getByRole("checkbox", { name: "Not keto", exact: true })
					.count(),
				0,
			);
			await page.getByRole("checkbox", { name: "Fish", exact: true }).check();
			await page.getByRole("button", { name: "Apply filters" }).click();
			await page.waitForURL("**/recipes/meals/?**");
			assert.equal(new URL(page.url()).searchParams.get("q"), "salmon");
			assert.equal(
				await page
					.getByRole("searchbox", { name: "Search recipes" })
					.inputValue(),
				"salmon",
			);
			const original = await cardIds(page);
			assert.deepEqual([...original].sort(), salmonFishIds);
			const orders = new Set([original.join(",")]);
			async function shuffleOnce() {
				await Promise.all([
					page.waitForEvent("load"),
					page.getByRole("button", { name: "Shuffle meals" }).click(),
				]);
				const ids = await cardIds(page);
				assert.deepEqual([...ids].sort(), [...original].sort());
				orders.add(ids.join(","));
				assert.equal(
					await page
						.getByRole("searchbox", { name: "Search recipes" })
						.inputValue(),
					"salmon",
				);
			}
			await shuffleOnce();
			await shuffleOnce();
			await shuffleOnce();
			assert.ok(
				orders.size > 1,
				"shuffle changes order while preserving every match",
			);
			const savedOrder = await cardIds(page);
			const savedSeed = await page.locator(SHUFFLE_SEED_FIELD).inputValue();
			assert.ok(savedSeed);
			assert.equal(
				await page
					.getByRole("checkbox", { name: "Fish", exact: true })
					.isChecked(),
				true,
			);
			await Promise.all([
				page.waitForEvent("load"),
				page.getByRole("button", { name: "Apply filters" }).click(),
			]);
			assert.deepEqual(await cardIds(page), savedOrder);
			assert.equal(
				await page.locator(SHUFFLE_SEED_FIELD).inputValue(),
				savedSeed,
			);
			assert.equal(
				await page
					.getByRole("checkbox", { name: "Fish", exact: true })
					.isChecked(),
				true,
			);
			assert.equal(
				await page
					.getByRole("searchbox", { name: "Search recipes" })
					.inputValue(),
				"salmon",
			);

			await page.getByRole("link", { name: "Reset filters" }).click();
			await page.waitForURL("**/recipes/meals/");
			assert.equal(
				await page.locator(".recipe-card").count(),
				Math.min(6, mealCount),
			);
			for (const vegetarian of [true, false]) {
				const legacy = new URL(page.url());
				legacy.searchParams.set("browse", "1");
				legacy.searchParams.set("mealKetoOnly", vegetarian ? "1" : "0");
				// biome-ignore lint/performance/noAwaitInLoops: verify stale native links before each form submission.
				await page.goto(legacy.href);
				assert.equal(
					await page
						.getByRole("checkbox", { name: "Keto", exact: true })
						.count(),
					0,
				);
				await page
					.getByRole("checkbox", { name: "Vegetarian", exact: true })
					.setChecked(vegetarian);
				await Promise.all([
					page.waitForEvent("load"),
					page.getByRole("button", { name: "Apply filters" }).click(),
				]);
				const expected = recipeData.recipes
					.filter(
						(recipe) =>
							recipe.type === "meal" &&
							(!vegetarian || recipe.vegetarian === true),
					)
					.map((recipe) => recipe.id)
					.sort();
				assert.deepEqual((await cardIds(page)).sort(), expected);
				assert.equal(
					new URL(page.url()).searchParams.has("mealKetoOnly"),
					false,
				);
				await Promise.all([
					page.waitForEvent("load"),
					page.getByRole("button", { name: "Shuffle meals" }).click(),
				]);
				assert.deepEqual((await cardIds(page)).sort(), expected);
				assert.equal(
					await page
						.getByRole("checkbox", { name: "Keto", exact: true })
						.count(),
					0,
				);
				assert.equal(
					await page
						.getByRole("checkbox", { name: "Vegetarian", exact: true })
						.isChecked(),
					vegetarian,
				);
			}
			await page.goto(`${server.origin}/recipes/smoothies/`);
			assert.equal(
				await page.getByRole("button", { name: "Shuffle smoothies" }).count(),
				1,
			);
			assert.equal(
				await page
					.getByRole("checkbox", { name: "Keto Friendly", exact: true })
					.count(),
				0,
			);
			assert.equal(ketoSmoothieIds.length, 4);
			assert.deepEqual((await cardIds(page)).sort(), ketoSmoothieIds);
			await page.goto(
				`${server.origin}/recipes/smoothies/?browse=1&smoothieKetoOnly=1`,
			);
			assert.deepEqual((await cardIds(page)).sort(), ketoSmoothieIds);
			await Promise.all([
				page.waitForEvent("load"),
				page.getByRole("button", { name: "Apply filters" }).click(),
			]);
			assert.equal(
				new URL(page.url()).searchParams.has("smoothieKetoOnly"),
				false,
			);
			assert.deepEqual((await cardIds(page)).sort(), ketoSmoothieIds);
			await page
				.getByRole("searchbox", { name: "Search recipes" })
				.fill("impossiblezzznomatch");
			await Promise.all([
				page.waitForEvent("load"),
				page.getByRole("button", { name: "Apply filters" }).click(),
			]);
			assert.equal(await page.locator(".recipe-card").count(), 0);
			assert.match(await page.locator(".no-results").textContent(), NO_MATCHES);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}
for (const width of [390, 1280]) nativeBrowseTest(width);

it("native rendering retains canonical and CSP script bytes, escapes hostile text and removes only library hydration", async () => {
	const original = new JSDOM(
		await readFile("dist/recipes/meals/index.html", "utf8"),
	);
	const request = new Request(
		`https://example.test/api/recipe-browse/?${new URLSearchParams({ path: "/recipes/meals/", browse: "1", q: HOSTILE_QUERY })}`,
		{ headers: { accept: "text/html" } },
	);
	const response = await browseResponse(request);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
	const rendered = new JSDOM(await response.text());
	try {
		const beforeDocument = original.window.document;
		const afterDocument = rendered.window.document;
		assert.equal(
			afterDocument.querySelector(CANONICAL).href,
			"https://www.jsolly.com/recipes/meals/",
		);
		assert.deepEqual(
			[...afterDocument.scripts].map((script) => script.textContent),
			[...beforeDocument.scripts].map((script) => script.textContent),
		);
		assert.equal(
			afterDocument.querySelector('meta[http-equiv="content-security-policy"]')
				.content,
			beforeDocument.querySelector('meta[http-equiv="content-security-policy"]')
				.content,
		);
		assert.equal(
			afterDocument.querySelector(".recipe-server-browse astro-island"),
			null,
		);
		assert.equal(
			afterDocument.querySelectorAll("astro-island").length,
			beforeDocument.querySelectorAll("astro-island").length - 1,
		);
		assert.equal(
			afterDocument.querySelector('[name="q"]').value,
			HOSTILE_QUERY,
		);
		assert.equal(
			afterDocument.querySelector("#recipe-browse-form").closest("noscript"),
			null,
		);
		const context = await browser.newContext({ serviceWorkers: "block" });
		try {
			const page = await context.newPage();
			const errors = collectErrors(page, { warnings: true });
			await page.goto(
				`${server.origin}/recipes/meals/?${new URLSearchParams({ browse: "1", q: "salmon" })}`,
			);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			assert.equal(
				await page
					.getByRole("searchbox", { name: "Search recipes" })
					.inputValue(),
				"salmon",
			);
			assert.ok(await page.locator(".recipe-server-browse").isVisible());
			assert.deepEqual(
				errors.filter(
					(message) =>
						message !== "Service Worker registration blocked by Playwright",
				),
				[],
			);
		} finally {
			await context.close();
		}
	} finally {
		original.window.close();
		rendered.window.close();
	}
});

it("native browse rejects invalid routes, methods and non-HTML and gives HEAD no body", async () => {
	await Promise.all(
		[
			["../../secret", {}, 404],
			["/recipes/meals/", { method: "POST" }, 405],
			["/recipes/meals/", { headers: { accept: "text/markdown" } }, 406],
		].map(async ([path, options, status]) => {
			const response = await browseResponse(
				new Request(
					`https://example.test/api/recipe-browse/?path=${encodeURIComponent(path)}`,
					options,
				),
			);
			assert.equal(response.status, status);
		}),
	);
	const head = await browseResponse(
		new Request(
			"https://example.test/api/recipe-browse/?path=/recipes/meals/",
			{
				method: "HEAD",
			},
		),
	);
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
});
