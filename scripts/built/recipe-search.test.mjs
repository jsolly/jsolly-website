// biome-ignore-all lint/performance/noAwaitInLoops: ordered browser interactions on one page.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import data from "../../src/components/recipes/recipe-data.server.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";

let site;
let browser;
before(async () => {
	site = await serveStatic("dist");
	browser = await chromium.launch();
});
after(async () => {
	await browser?.close();
	await site?.close();
});

const SIX_SERVINGS = /6 servings/su;
const PROTEINS = /^Proteins:/u;
const OPEN_RECIPE = /^Open recipe:/u;
const SMOOTHIE = /smoothie/iu;

function verifyLibrary(width) {
	it(`recipe search, aligned settings and individual card printing at ${width}px`, {
		timeout: 60_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width, height: 984 },
			reducedMotion: "reduce",
			serviceWorkers: "block",
		});
		await context.addInitScript(() => {
			window.printPackets = [];
			window.print = () => {
				window.printPackets.push(
					document.querySelector(".print-output").textContent,
				);
			};
		});
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.goto(`${site.origin}/recipes/`);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			assert.equal(
				await page
					.locator(".recipe-card a.title-button")
					.evaluateAll((links) =>
						links.every(
							(link) =>
								link.getAttribute("href") ===
								`/recipes/${link.dataset.recipeId}/`,
						),
					),
				true,
				"default hydrated cards retain direct canonical links",
			);
			const servings = page.getByRole("combobox", {
				name: "Servings",
				exact: true,
			});
			const units = page.getByRole("combobox", { name: "Ingredient units" });
			const a = await servings.boundingBox();
			const b = await units.boundingBox();
			const wrapper = await page
				.locator('.servings-setting [data-slot="native-select-wrapper"]')
				.boundingBox();
			assert.ok(
				Math.abs(wrapper.width - a.width) < 2,
				"servings arrow stays inside its field",
			);
			assert.ok(
				width > 600 ? Math.abs(a.y - b.y) < 2 : b.y > a.y,
				`settings at ${width}px: ${a.y}, ${b.y}`,
			);
			const cardIds = () =>
				page
					.locator(".recipe-card a.title-button")
					.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
			assert.deepEqual(
				await cardIds(),
				data.recipes
					.filter((recipe) => recipe.type === "meal")
					.map((recipe) => recipe.id)
					.slice(0, 6),
			);
			const diet = page.getByRole("checkbox", {
				name: "Vegetarian",
				exact: true,
			});
			await diet.check();
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			const beforeShuffle = await cardIds();
			await page.evaluate(() => {
				// Fixed seed reverses this two-recipe vegetarian fixture.
				Object.defineProperty(crypto, "randomUUID", { value: () => "0" });
			});
			await page.getByRole("button", { name: "Shuffle meals" }).click();
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			const afterShuffle = await cardIds();
			assert.notDeepEqual(afterShuffle, beforeShuffle);
			assert.deepEqual([...afterShuffle].sort(), [...beforeShuffle].sort());
			assert.equal(await diet.isChecked(), true);
			await diet.uncheck();
			await servings.selectOption("6");
			await units.selectOption("metric");
			const search = page.getByRole("searchbox", { name: "Search recipes" });
			const fullSearch = page.waitForResponse((response) => {
				const url = new URL(response.url());
				return (
					url.pathname === "/api/recipe-browse/" &&
					url.searchParams.get("q") === "jalapeno popper stuffed"
				);
			});
			await search.fill("jalapeno popper stuffed");
			const searchPage = await (await fullSearch).json();
			const distantRecipe = data.recipes.find(
				(recipe) =>
					recipe.id === "source-jalapen-o-popper-stuffed-chicken-breast",
			);
			assert.ok(distantRecipe);
			assert.ok(
				!data.recipes
					.filter((recipe) => recipe.type === "meal")
					.slice(0, 6)
					.some((recipe) => recipe.id === distantRecipe.id),
			);
			assert.ok(
				searchPage.cards.some((recipe) => recipe.id === distantRecipe.id),
				"the API searches recipes beyond the initial six cards",
			);
			const cards = page.locator(".recipe-grid .recipe-card");
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			await cards.first().waitFor();
			assert.deepEqual(
				await cardIds(),
				searchPage.cards.map((recipe) => recipe.id),
			);
			const mealId = await cards
				.first()
				.locator("[data-recipe-id]")
				.getAttribute("data-recipe-id");
			await cards
				.first()
				.getByRole("button", { name: "Print recipe", exact: true })
				.focus();
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => window.printPackets.length === 1);
			assert.equal(await page.locator(".print-output .print-meal").count(), 1);
			assert.equal(
				await page.locator(".print-output .print-title").textContent(),
				data.recipes.find((recipe) => recipe.id === mealId).title,
			);
			assert.match(
				await page.locator(".print-output").textContent(),
				SIX_SERVINGS,
			);
			assert.equal(
				await page.evaluate(() => location.pathname),
				"/recipes/",
				"card printing stays on the library",
			);
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await page.waitForFunction(
				() => !document.querySelector(".print-output .print-meal"),
			);
			await search.fill("zzzznotaningredient");
			await page
				.getByText("No recipes match your search and filters.", {
					exact: false,
				})
				.waitFor();
			assert.equal(await cards.count(), 0);
			await search.fill("chikcen");
			await cards.first().waitFor();
			assert.ok((await cards.count()) > 0);
			await search.fill("");
			await page.getByRole("button", { name: PROTEINS }).click();
			await page.getByRole("checkbox", { name: "Fish", exact: true }).click();
			await page.keyboard.press("Escape");
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			const fishOrder = await cards
				.locator("[data-recipe-id]")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
			assert.ok(fishOrder.length > 0);
			await search.fill("jalapeno popper stuffed");
			await page
				.getByText("No recipes match your search and filters.", {
					exact: false,
				})
				.waitFor();
			await search.fill("");
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			await cards.first().waitFor();
			assert.deepEqual(
				await cards
					.locator("[data-recipe-id]")
					.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
				fishOrder,
			);
			await page.getByRole("link", { name: "Smoothies", exact: true }).click();
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			await search.fill("avocado lime");
			await page.waitForFunction(
				() =>
					document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false",
			);
			await cards.first().waitFor();
			assert.ok((await cards.count()) > 0);
			assert.match(await cards.first().textContent(), SMOOTHIE);
			const smoothieId = await cards
				.first()
				.locator("[data-recipe-id]")
				.getAttribute("data-recipe-id");
			await cards
				.first()
				.getByRole("button", { name: "Print recipe", exact: true })
				.click();
			await page.waitForFunction(() => window.printPackets.length === 1);
			assert.equal(await page.locator(".print-output .print-meal").count(), 1);
			assert.equal(
				await page.locator(".print-output .print-title").textContent(),
				data.recipes.find((recipe) => recipe.id === smoothieId).title,
			);
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			if (process.env.UI_EVIDENCE_DIR) {
				await mkdir(process.env.UI_EVIDENCE_DIR, { recursive: true });
				await page.goto(`${site.origin}/recipes/`);
				await page.waitForFunction(
					() => !document.querySelector("astro-island[ssr]"),
				);
				await page.getByRole("button", { name: PROTEINS }).click();
				const clear = page.getByRole("button", {
					name: "Clear selections",
					exact: true,
				});
				if (await clear.isEnabled()) await clear.click();
				await page.keyboard.press("Escape");
				for (const colorScheme of ["light", "dark"]) {
					await page.emulateMedia({ colorScheme });
					await page.evaluate(() => window.scrollTo(0, 0));
					await page.screenshot({
						path: `${process.env.UI_EVIDENCE_DIR}/recipe-library-${width}-${colorScheme}.png`,
						fullPage: false,
					});
					await cards.first().screenshot({
						path: `${process.env.UI_EVIDENCE_DIR}/recipe-card-${width}-${colorScheme}.png`,
					});
				}
			}
			assert.deepEqual(
				errors.filter(
					(error) =>
						error !== "Service Worker registration blocked by Playwright",
				),
				[],
			);
		} finally {
			await context.close();
		}
	});
}

verifyLibrary(390);
verifyLibrary(765);
verifyLibrary(1280);

it("recipe batches load by scroll and button; shuffle retains current cards and preserves filters", {
	timeout: 60000,
}, async () => {
	// Prove automatic pagination with the real observer first. Keyboard pagination
	// has its own context: focusing newly added cards scrolls the viewport, which
	// otherwise lets the observer load another batch before the next key press.
	const scrolling = await browser.newContext({
		viewport: { width: 1280, height: 984 },
		serviceWorkers: "block",
	});
	try {
		const scrollPage = await scrolling.newPage();
		await scrollPage.goto(`${site.origin}/recipes/meals/`);
		await scrollPage.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(await scrollPage.locator(".recipe-card").count(), 6);
		await scrollPage
			.getByRole("button", { name: "Load more recipes" })
			.scrollIntoViewIfNeeded();
		await scrollPage.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length >= 12,
		);
	} finally {
		await scrolling.close();
	}
	const context = await browser.newContext({
		viewport: { width: 1280, height: 984 },
		serviceWorkers: "block",
	});
	await context.addInitScript(() => {
		// biome-ignore lint/performance/noDelete: exercise the browser fallback, which checks property presence with "in".
		delete window.IntersectionObserver;
		Object.defineProperty(navigator, "connection", {
			configurable: true,
			value: Object.assign(new EventTarget(), {
				saveData: true,
				effectiveType: "4g",
			}),
		});
	});
	const page = await context.newPage();
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(await page.locator(".recipe-card").count(), 6);
		const initialIds = await page
			.locator(".recipe-card .title-button")
			.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
		let releaseShuffle;
		let markRequested;
		const held = new Promise((resolve) => {
			releaseShuffle = resolve;
		});
		const requested = new Promise((resolve) => {
			markRequested = resolve;
		});
		await page.route(
			(url) =>
				url.pathname === "/api/recipe-browse/" &&
				url.searchParams.get("shuffle") === "1",
			async (route) => {
				markRequested();
				await held;
				await route.continue();
			},
		);
		const shuffledResponse = page.waitForResponse(
			(response) => new URL(response.url()).searchParams.get("shuffle") === "1",
		);
		await page.getByRole("button", { name: "Shuffle meals" }).click();
		await requested;
		assert.equal(
			await page.locator("#meal-results").getAttribute("aria-busy"),
			"true",
		);
		assert.equal(
			await page
				.locator(".recipe-grid")
				.evaluate(
					(grid) => !grid.inert && getComputedStyle(grid).opacity === "1",
				),
			true,
		);
		assert.deepEqual(
			await page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
			initialIds,
		);
		releaseShuffle();
		const shuffledPage = await (await shuffledResponse).json();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.ok(shuffledPage.seed);
		assert.deepEqual(
			await page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
			shuffledPage.cards.map((card) => card.id),
		);
		assert.notDeepEqual(
			shuffledPage.cards.map((card) => card.id),
			initialIds,
		);
		const nextShuffled = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				url.pathname === "/api/recipe-browse/" &&
				url.searchParams.get("page") === "2"
			);
		});
		const more = page.getByRole("button", { name: "Load more recipes" });
		await more.focus();
		await page.keyboard.press("Enter");
		await page.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length >= 12,
		);
		const nextPage = await (await nextShuffled).json();
		assert.equal(nextPage.seed, shuffledPage.seed);
		assert.deepEqual(
			await page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
			[...shuffledPage.cards, ...nextPage.cards].map((card) => card.id),
		);
		assert.equal(
			new Set([...shuffledPage.cards, ...nextPage.cards].map((card) => card.id))
				.size,
			12,
		);
		await page.evaluate(() => window.scrollTo(0, 0));
		await more.focus();
		await page.keyboard.press("Enter");
		await page.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length >= 18,
		);

		assert.equal(
			await page
				.locator(".recipe-card .title-button")
				.nth(12)
				.evaluate((link) => link === document.activeElement),
			true,
		);
		await page.keyboard.press("Tab");
		assert.equal(
			await page
				.locator(".recipe-card")
				.nth(12)
				.getByRole("link", { name: OPEN_RECIPE })
				.evaluate((link) => link === document.activeElement),
			true,
		);
		while (await more.count()) {
			const previous = await page.locator(".recipe-card").count();
			await page.evaluate(() => window.scrollTo(0, 0));
			await more.focus();
			await page.keyboard.press("Enter");
			await page.waitForFunction(
				(previousCount) =>
					document.querySelectorAll(".recipe-card").length > previousCount,
				previous,
			);
			assert.equal(
				await page
					.locator(".recipe-card .title-button")
					.nth(previous)
					.evaluate((link) => link === document.activeElement),
				true,
			);
		}
		const count = page.getByRole("combobox", {
			name: "Pressure cookers count",
			exact: true,
		});
		assert.deepEqual(
			await count
				.locator("option")
				.evaluateAll((options) => options.map((option) => option.value)),
			["1", "2"],
		);
		await page
			.getByRole("checkbox", { name: "Pressure cookers", exact: true })
			.uncheck();
		assert.equal(await count.isDisabled(), true);
		await page
			.getByRole("checkbox", { name: "Pressure cookers", exact: true })
			.check();
		await page
			.getByRole("checkbox", { name: "Dump and go", exact: true })
			.check();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.equal(await page.locator(".recipe-card").count(), 2);
		const ids = await page
			.locator("[data-recipe-id]")
			.evaluateAll((links) =>
				links.map((link) => link.dataset.recipeId).sort(),
			);
		await page.getByRole("button", { name: "Shuffle meals" }).click();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.deepEqual(
			await page
				.locator("[data-recipe-id]")
				.evaluateAll((links) =>
					links.map((link) => link.dataset.recipeId).sort(),
				),
			ids,
		);
		assert.equal(
			await page
				.getByRole("checkbox", { name: "Dump and go", exact: true })
				.isChecked(),
			true,
		);
		await page
			.getByRole("checkbox", { name: "Dump and go", exact: true })
			.uncheck();
		await page.evaluate(() => window.scrollTo(0, 0));
		for (const label of ["Proteins", "Carbs"]) {
			const trigger = page.getByRole("button", {
				name: new RegExp(`^${label}:`, "u"),
			});
			await trigger.evaluate((element) =>
				window.scrollBy(0, element.getBoundingClientRect().top - 100),
			);
			await trigger.click();
			const panel = page.getByRole("dialog", { name: `${label} choices` });
			await page.waitForFunction(
				(panelLabel) =>
					document
						.querySelector(
							`[role="dialog"][aria-label="${panelLabel} choices"]`,
						)
						?.getAttribute("data-side") === "bottom",
				label,
			);
			assert.equal(
				await panel.getAttribute("data-side"),
				"bottom",
				JSON.stringify({
					label,
					trigger: await trigger.boundingBox(),
					panel: await panel.boundingBox(),
				}),
			);
			await page.keyboard.press("Escape");
		}
	} finally {
		await context.close();
	}
});

it("background summaries leave six cards mounted and defer distant images and all recipe detail packs", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 700 },
		serviceWorkers: "block",
	});
	const page = await context.newPage();
	const requested = [];
	page.on("request", (request) =>
		requested.push(new URL(request.url()).pathname),
	);
	try {
		const thirdPage = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				url.pathname === "/api/recipe-browse/" &&
				url.searchParams.get("page") === "3"
			);
		});
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		assert.equal(await page.locator(".recipe-card").count(), 6);
		const background = await (await thirdPage).json();
		assert.equal(background.page, 3);
		assert.equal(background.cards.length, 6);
		assert.equal(
			await page.locator(".recipe-card").count(),
			6,
			"prefetched summaries do not mount cards",
		);
		assert.equal(
			requested.some((path) => path.startsWith("/recipes/data/packs/")),
			false,
		);
		const last = data.recipes.filter((recipe) => recipe.type === "meal")[5];
		const candidates = last.image.cardSrcset
			.split(",")
			.map((candidate) => candidate.trim().split(" ")[0]);
		assert.equal(
			candidates.some((path) => requested.includes(path)),
			false,
			"the sixth image is below the viewport and its margin",
		);
		await page
			.getByRole("button", { name: "Load more recipes" })
			.scrollIntoViewIfNeeded();
		await page.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length === 12,
		);
		assert.deepEqual(
			await page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
			data.recipes
				.filter((recipe) => recipe.type === "meal")
				.slice(0, 12)
				.map((recipe) => recipe.id),
		);
		assert.equal(
			requested.some((path) => path.startsWith("/recipes/data/packs/")),
			false,
		);
	} finally {
		await context.close();
	}
});

it("a superseded slow search cannot replace current results and Retry preserves the failed search intent", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "block",
	});
	await context.addInitScript(() => {
		Object.defineProperty(navigator, "connection", {
			value: Object.assign(new EventTarget(), {
				saveData: true,
				effectiveType: "4g",
			}),
			configurable: true,
		});
		// biome-ignore lint/performance/noDelete: exercise the browser fallback, which checks property presence with "in".
		delete window.IntersectionObserver;
	});
	const page = await context.newPage();
	let releaseOld;
	const held = new Promise((resolve) => {
		releaseOld = resolve;
	});
	let markOld;
	const oldRequested = new Promise((resolve) => {
		markOld = resolve;
	});
	let markOldFinished;
	const oldFinished = new Promise((resolve) => {
		markOldFinished = resolve;
	});
	let failures = 0;
	try {
		await page.route(
			(url) => url.pathname === "/api/recipe-browse/",
			async (route) => {
				const url = new URL(route.request().url());
				if (url.searchParams.get("q") === "salmon") {
					const response = await route.fetch();
					markOld();
					await held;
					try {
						await route.fulfill({ response });
					} catch {
						/* The aborted old request has already been discarded. */
					}
					markOldFinished();
					return;
				}
				if (
					url.searchParams.get("q") === "jalapeno popper stuffed" &&
					failures++ === 0
				) {
					await route.fulfill({
						status: 503,
						contentType: "application/json",
						body: '{"error":"temporary"}',
					});
					return;
				}
				await route.continue();
			},
		);
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		const search = page.getByRole("searchbox", { name: "Search recipes" });
		await search.fill("salmon");
		await oldRequested;
		const currentResponse = page.waitForResponse(
			(response) => new URL(response.url()).searchParams.get("q") === "chicken",
		);
		await search.fill("chicken");
		const current = await (await currentResponse).json();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		const ids = () =>
			page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
		assert.deepEqual(
			await ids(),
			current.cards.map((recipe) => recipe.id),
		);
		releaseOld();
		await oldFinished;
		assert.deepEqual(
			await ids(),
			current.cards.map((recipe) => recipe.id),
		);
		assert.equal(await search.inputValue(), "chicken");
		await search.fill("jalapeno popper stuffed");
		await page.getByRole("alert").waitFor();
		assert.deepEqual(
			await ids(),
			current.cards.map((recipe) => recipe.id),
			"failure preserves the current cards",
		);
		const retryResponse = page.waitForResponse(
			(response) => new URL(response.url()).pathname === "/api/recipe-browse/",
		);
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		const retryResult = await retryResponse;
		const request = new URL(retryResult.url());
		assert.equal(request.searchParams.get("q"), "jalapeno popper stuffed");
		assert.equal(
			request.searchParams.get("page"),
			"1",
			"retry repeats the failed first-page search",
		);
		const retried = await retryResult.json();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.deepEqual(
			await ids(),
			retried.cards.map((recipe) => recipe.id),
		);
		assert.ok(
			retried.cards.some(
				(recipe) =>
					recipe.id === "source-jalapen-o-popper-stuffed-chicken-breast",
			),
		);
		assert.equal(await page.getByRole("alert").count(), 0);
	} finally {
		releaseOld?.();
		await context.close();
	}
});

it("hovering or focusing a card downloads no pack, card Print downloads exactly one, card links navigate, and Data Saver pauses speculative work", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "block",
	});
	await context.addInitScript(() => {
		window.printedTitles = [];
		window.print = () => {
			window.printedTitles.push(
				document.querySelector(".print-output .print-title")?.textContent,
			);
		};
	});
	const page = await context.newPage();
	const errors = collectErrors(page);
	const packs = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith("/recipes/data/packs/")) packs.push(path);
	});
	const title = (id) => data.recipes.find((recipe) => recipe.id === id).title;
	try {
		await page.clock.install();
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		const cards = page.locator(".recipe-card");
		const firstId = await cards
			.nth(0)
			.locator(".title-button")
			.getAttribute("data-recipe-id");
		const secondId = await cards
			.nth(1)
			.locator(".title-button")
			.getAttribute("data-recipe-id");
		await cards.nth(0).hover();
		await cards.nth(1).locator(".title-button").focus();
		await page.clock.runFor(1000);
		assert.deepEqual(packs, [], "hover and focus download no recipe pack");
		await cards
			.nth(1)
			.getByRole("button", { name: "Print recipe", exact: true })
			.click();
		await page.waitForFunction(() => window.printedTitles.length === 1);
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await cards
			.nth(1)
			.getByRole("button", { name: "Print recipe", exact: true })
			.click();
		await page.waitForFunction(() => window.printedTitles.length === 2);
		assert.deepEqual(
			{
				printed: await page.evaluate(() => window.printedTitles),
				packs,
			},
			{
				printed: [title(secondId), title(secondId)],
				packs: [`/recipes/data/packs/${secondId}.json`],
			},
			"card Print downloads its pack once and reuses it",
		);
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await cards.nth(0).locator(".title-button").click();
		await page.waitForURL(`${site.origin}/recipes/${firstId}/`);
		await page.locator(".recipe-detail").waitFor();
		assert.deepEqual(
			packs,
			[`/recipes/data/packs/${secondId}.json`],
			"following a card link downloads no pack",
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
	const saver = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "block",
	});
	await saver.addInitScript(() => {
		Object.defineProperty(navigator, "connection", {
			value: Object.assign(new EventTarget(), {
				saveData: true,
				effectiveType: "4g",
			}),
			configurable: true,
		});
	});
	const saving = await saver.newPage();
	const saverErrors = collectErrors(saving);
	const speculative = [];
	saving.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (
			path === "/api/recipe-browse/" ||
			path.startsWith("/recipes/data/packs/")
		)
			speculative.push(path);
	});
	try {
		await saving.clock.install();
		await saving.goto(`${site.origin}/recipes/meals/`);
		await saving.locator("[data-hydrated=true]").waitFor();
		await saving.locator(".recipe-card").first().hover();
		await saving.locator(".recipe-card .title-button").first().focus();
		await saving.clock.runFor(1000);
		assert.deepEqual(
			speculative,
			[],
			"Data Saver starts no summary trickle, and hover or focus downloads nothing",
		);
		const link = saving.locator(".recipe-card .title-button").first();
		const id = await link.getAttribute("data-recipe-id");
		await link.click();
		await saving.waitForURL(`${site.origin}/recipes/${id}/`);
		await saving
			.locator(`.recipe-page section#${id}`)
			.getByRole("heading", { level: 1, name: title(id) })
			.waitFor();
		assert.deepEqual(
			speculative,
			[],
			"opening a recipe with Data Saver navigates to its page without speculative downloads",
		);
		assert.deepEqual(saverErrors, []);
	} finally {
		await saver.close();
	}
});
