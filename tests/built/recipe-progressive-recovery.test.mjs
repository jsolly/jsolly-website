// biome-ignore-all lint/performance/noAwaitInLoops: sequential browser scenarios keep worker contexts isolated.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";
import { holdRecipeArtifact } from "./recipe-artifact-gate.mjs";

const RAW_IMAGE = /<img\s/u;
const PROTEINS = /^Proteins:/u;
const { recipes } = JSON.parse(
	await readFile(
		new URL("../../src/components/recipes/recipes.json", import.meta.url),
		"utf8",
	),
);
const fishIds = new Set(
	recipes
		.filter((recipe) => recipe.proteinType === "fish")
		.map((recipe) => recipe.id),
);
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
const ids = (page) =>
	page
		.locator(".recipe-card .title-button")
		.evaluateAll((links) => links.map((link) => link.dataset.recipeId));

it("scroll demand joins a pending background batch and keeps the Load more control focusable", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "block",
	});
	const page = await context.newPage();
	const summary = await holdRecipeArtifact(page, "summaries");
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		await summary.started;
		const more = page.getByRole("button", {
			name: "Load more recipes",
			exact: true,
		});
		await more.focus();
		assert.equal(await more.isEnabled(), true);
		assert.equal(
			await more.evaluate((node) => node === document.activeElement),
			true,
		);
		await page.locator(".load-more").scrollIntoViewIfNeeded();
		await page.waitForFunction(
			() =>
				document.querySelector(".load-more").getBoundingClientRect().top <
				innerHeight,
		);
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await more.press("Enter");
		summary.release();
		await page.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length === 12,
		);
		assert.equal((await ids(page)).length, 12);
		assert.equal(
			await page
				.locator(".recipe-card .title-button")
				.nth(6)
				.evaluate((node) => node === document.activeElement),
			true,
		);
	} finally {
		summary.release();
		await context.close();
	}
});

it("local shuffle remains stable after searching and clearing the query", {
	timeout: 40_000,
}, async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "block",
	});
	const page = await context.newPage();
	const errors = collectErrors(page);
	const complete = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname.startsWith("/recipes/data/summaries/") &&
			response.ok(),
	);
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		await (await complete).json();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		await page
			.getByRole("button", { name: "Shuffle meals", exact: true })
			.click();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		const shuffled = await ids(page);
		const search = page.getByRole("searchbox", { name: "Search recipes" });
		const queryResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname.startsWith("/recipes/data/search/") &&
				response.ok(),
		);
		await search.fill("chicken");
		await (await queryResponse).json();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		await search.fill("");
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.deepEqual(await ids(page), shuffled);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("native browse card images load with JavaScript enabled and disabled", {
	timeout: 30_000,
}, async () => {
	for (const javaScriptEnabled of [false, true]) {
		const context = await browser.newContext({
			javaScriptEnabled,
			serviceWorkers: "block",
			viewport: { width: 1280, height: 900 },
		});
		try {
			const page = await context.newPage();
			await page.goto(`${site.origin}/recipes/meals/?browse=1&page=2`);
			assert.equal(await page.locator(".recipe-card").count(), 6);
			assert.equal(
				await page.locator(".recipe-card .deferred-card-image").count(),
				0,
			);
			const image = page.locator(".recipe-card img").first();
			await image.scrollIntoViewIfNeeded();
			await page.waitForFunction(
				() => document.querySelector(".recipe-card img")?.naturalWidth > 0,
			);
			assert.equal(await image.getAttribute("loading"), "lazy");
			assert.doesNotMatch(
				await page.locator(".recipe-grid").textContent(),
				RAW_IMAGE,
			);
		} finally {
			await context.close();
		}
	}
});

it("a failed release-update check reports retry guidance without an unhandled rejection", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({ serviceWorkers: "block" });
	await context.addInitScript(() => {
		Object.defineProperty(navigator.serviceWorker, "getRegistration", {
			value: () =>
				Promise.resolve({
					update: () => Promise.reject(new Error("Update network failure")),
				}),
		});
	});
	const page = await context.newPage();
	const errors = collectErrors(page);
	await page.route("**/recipes/data/summaries/**", (route) =>
		route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
	);
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page
			.getByRole("button", { name: "Check for update", exact: true })
			.click();
		await page
			.locator(".action-status")
			.filter({ hasText: "The update could not be checked." })
			.waitFor();
		assert.equal(
			await page
				.getByRole("button", { name: "Check for update", exact: true })
				.isEnabled(),
			true,
		);
		assert.deepEqual(errors, [
			"Failed to load resource: the server responded with a status of 404 (Not Found)",
		]);
	} finally {
		await context.close();
	}
});

it("Retry after a failed next batch renders the requested cards", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({
		serviceWorkers: "block",
		viewport: { width: 1280, height: 900 },
	});
	await context.addInitScript(() =>
		Object.defineProperty(navigator, "connection", {
			value: Object.assign(new EventTarget(), { saveData: true }),
		}),
	);
	const page = await context.newPage();
	let failed = false;
	const attempts = [];
	await page.route("**/recipes/data/summaries/**", (route) => {
		attempts.push(route.request().url());
		if (!failed) {
			failed = true;
			return route.fulfill({ status: 503, body: "Unavailable" });
		}
		return route.continue();
	});
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		await page
			.getByRole("button", { name: "Load more recipes", exact: true })
			.click();
		await page.getByRole("alert").waitFor();
		assert.equal((await ids(page)).length, 6);
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await page.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length === 12,
		);
		assert.equal(await page.getByRole("alert").count(), 0);
		assert.equal(attempts.length, 2);
		assert.equal(
			attempts[0],
			attempts[1],
			"Retry repeats the exact failed library identity",
		);
		assert.deepEqual(
			await ids(page),
			recipes
				.filter((recipe) => recipe.type === "meal")
				.slice(0, 12)
				.map(({ id }) => id),
		);
	} finally {
		await context.close();
	}
});

it("Shuffle supersedes a pending filter refresh and retains the selected filter", {
	timeout: 40_000,
}, async () => {
	const context = await browser.newContext({
		serviceWorkers: "block",
		viewport: { width: 1280, height: 900 },
	});
	await context.addInitScript(() => {
		Object.defineProperty(navigator, "connection", {
			configurable: true,
			value: Object.assign(new EventTarget(), {
				saveData: true,
				effectiveType: "4g",
			}),
		});
		Object.defineProperty(crypto, "randomUUID", { value: () => "0" });
	});
	const page = await context.newPage();
	const summary = await holdRecipeArtifact(page, "summaries");
	const requests = [];
	page.on("request", (request) =>
		requests.push(new URL(request.url()).pathname),
	);
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		assert.equal(
			await page.getByRole("checkbox", { name: "Keto", exact: true }).count(),
			0,
		);
		const initialCards = await ids(page);
		await page.getByRole("button", { name: PROTEINS }).click();
		await page.getByRole("checkbox", { name: "Fish", exact: true }).check();
		await page.keyboard.press("Escape");
		await summary.started;
		assert.deepEqual(
			await ids(page),
			initialCards,
			"filter demand retains cards while its library is pending",
		);
		await page
			.getByRole("button", { name: "Shuffle meals", exact: true })
			.click();
		assert.equal(
			await page.locator("#meal-results").getAttribute("aria-busy"),
			"true",
		);
		summary.release();
		await summary.finished;
		await page.waitForFunction(
			(total) =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
					"false" &&
				Number(
					document
						.querySelector("#meal-results")
						.getAttribute("data-match-count"),
				) === total,
			fishIds.size,
		);
		const shuffled = await ids(page);
		assert.equal(shuffled.length, Math.min(6, fishIds.size));
		assert.ok(shuffled.every((id) => fishIds.has(id)));
		assert.notDeepEqual(
			shuffled,
			recipes
				.filter((recipe) => recipe.type === "meal" && fishIds.has(recipe.id))
				.slice(0, 6)
				.map(({ id }) => id),
			"the newer shuffle wins over the pending canonical filter order",
		);
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		assert.deepEqual(
			await ids(page),
			shuffled,
			"superseded filter completion cannot restore its older order",
		);
		await page.getByRole("button", { name: PROTEINS }).click();
		assert.equal(
			await page
				.getByRole("checkbox", { name: "Fish", exact: true })
				.isChecked(),
			true,
		);
		await page.keyboard.press("Escape");
		const carbs = await page
			.locator(".recipe-card .carb-value")
			.allTextContents();
		assert.ok(
			carbs.every(
				(value) =>
					Number.isFinite(Number.parseFloat(value)) &&
					Number.parseFloat(value) <= 12.5,
			),
		);
		assert.equal(
			await page
				.locator(".recipe-card")
				.getByText("Not keto", { exact: true })
				.count(),
			0,
		);
		assert.equal(
			requests.filter((path) => path.startsWith("/recipes/data/summaries/"))
				.length,
			1,
		);
		assert.ok(!requests.includes("/api/recipe-browse/"));
	} finally {
		summary.release();
		await context.close();
	}
});
