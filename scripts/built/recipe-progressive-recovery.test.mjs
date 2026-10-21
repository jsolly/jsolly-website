// biome-ignore-all lint/performance/noAwaitInLoops: sequential browser scenarios keep worker contexts isolated.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";

const RAW_IMAGE = /<img\s/u;
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
	let release;
	let requested;
	const pending = new Promise((resolve) => {
		requested = resolve;
	});
	const held = new Promise((resolve) => {
		release = resolve;
	});
	await page.route("**/api/recipe-browse/?**", async (route) => {
		if (new URL(route.request().url()).searchParams.get("page") === "2") {
			requested();
			await held;
		}
		await route.continue();
	});
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		await pending;
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
		release();
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
		release();
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
	let allLoaded;
	const complete = new Promise((resolve) => {
		allLoaded = resolve;
	});
	page.on("response", async (response) => {
		if (
			new URL(response.url()).pathname !== "/api/recipe-browse/" ||
			!response.ok()
		)
			return;
		const result = await response.json();
		if (!result.nextPage && !new URL(response.url()).searchParams.get("q"))
			allLoaded();
	});
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		await complete;
		await page
			.getByRole("button", { name: "Shuffle meals", exact: true })
			.click();
		const shuffled = await ids(page);
		const search = page.getByRole("searchbox", { name: "Search recipes" });
		const queryResponse = page.waitForResponse(
			(response) => new URL(response.url()).searchParams.get("q") === "chicken",
		);
		await search.fill("chicken");
		await queryResponse;
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		const clear = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/api/recipe-browse/" &&
				new URL(response.url()).searchParams.get("q") === "" &&
				new URL(response.url()).searchParams.get("page") === "1",
		);
		await search.fill("");
		await clear;
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
	await page.route("**/api/recipe-browse/?**", (route) =>
		route.fulfill({ status: 409, contentType: "application/json", body: "{}" }),
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
			"Failed to load resource: the server responded with a status of 409 (Conflict)",
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
	await page.route("**/api/recipe-browse/?**", (route) => {
		if (
			new URL(route.request().url()).searchParams.get("page") === "2" &&
			!failed
		) {
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
	const page = await context.newPage();
	let complete;
	const downloaded = new Promise((resolve) => {
		complete = resolve;
	});
	page.on("response", async (response) => {
		if (
			new URL(response.url()).pathname !== "/api/recipe-browse/" ||
			!response.ok()
		)
			return;
		const result = await response.json();
		if (!result.nextPage) complete();
	});
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	let filterStarted;
	const filtering = new Promise((resolve) => {
		filterStarted = resolve;
	});
	await page.route("**/api/recipe-browse/?**", async (route) => {
		const url = new URL(route.request().url());
		if (
			url.searchParams.get("mealKetoOnly") === "1" &&
			!url.searchParams.has("shuffle") &&
			url.searchParams.get("page") === "1"
		) {
			filterStarted();
			await held;
		}
		await route.continue();
	});
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		await downloaded;
		await page.getByRole("checkbox", { name: "Keto", exact: true }).check();
		await filtering;
		const shuffled = page.waitForResponse(
			(response) => new URL(response.url()).searchParams.get("shuffle") === "1",
		);
		await page
			.getByRole("button", { name: "Shuffle meals", exact: true })
			.click();
		const result = await (await shuffled).json();
		assert.ok(result.seed);
		release();
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.deepEqual(
			await ids(page),
			result.cards.map((card) => card.id),
		);
		assert.equal(
			await page
				.getByRole("checkbox", { name: "Keto", exact: true })
				.isChecked(),
			true,
		);
		assert.equal(
			await page
				.locator(".recipe-card")
				.getByText("Not keto", { exact: true })
				.count(),
			0,
		);
	} finally {
		release();
		await context.close();
	}
});

it("leaving a delayed legacy recipe open cancels its dialog and loading state", {
	timeout: 30_000,
}, async () => {
	const context = await browser.newContext({ serviceWorkers: "block" });
	const page = await context.newPage();
	let release, requested;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const pending = new Promise((resolve) => {
		requested = resolve;
	});
	await page.route("**/recipes/data/packs/*.json", async (route) => {
		requested();
		await held;
		await route.continue();
	});
	try {
		await page.goto(`${site.origin}/recipes/meals/`);
		await page.locator("[data-hydrated=true]").waitFor();
		const id = (await ids(page))[0];
		await page.evaluate((value) => {
			location.hash = value;
		}, id);
		await pending;
		await page.goBack();
		await page.waitForFunction(() => !location.hash);
		const response = page.waitForResponse((value) =>
			value.url().includes("/recipes/data/packs/"),
		);
		release();
		await response;
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		assert.equal(await page.locator(".recipe-takeover").count(), 0);
		assert.equal(
			await page.getByText("Loading recipe…", { exact: true }).count(),
			0,
		);
		assert.equal(
			await page
				.locator(".recipe-card")
				.first()
				.getByRole("button", { name: "Print recipe", exact: true })
				.isEnabled(),
			true,
		);
	} finally {
		release();
		await context.close();
	}
});
