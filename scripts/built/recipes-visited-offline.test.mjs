import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { it } from "vitest";
import {
	browser,
	navigateHydrated,
	SAVED,
	serve,
	site,
	snapshots,
	statusText,
	stopRecipeWorkers,
} from "./recipes-pwa-fixture.mjs";

const ASSISTANT_EXPORTS = [
	"/recipes/data/recipe-library.json",
	"/recipes/data/recipe-library.md",
];
const PROTEINS = /^Proteins:/u;
const SAVE_ERROR = /could not be saved/iu;
const ID = "lemon-salmon-and-asparagus";
const OTHER = "shawarma-chicken-bowls";
const RELEASE_A = "a".repeat(40);
const RELEASE_B = "b".repeat(40);
function message(page, data) {
	return page.evaluate(
		(value) =>
			new Promise((resolve, reject) => {
				const channel = new MessageChannel();
				const timeout = setTimeout(
					() => reject(new Error("Worker response timed out")),
					30_000,
				);
				channel.port1.onmessage = ({ data: response }) => {
					clearTimeout(timeout);
					channel.port1.close();
					resolve(response);
				};
				navigator.serviceWorker.controller.postMessage(value, [channel.port2]);
			}),
		data,
	);
}
async function install(page) {
	await navigateHydrated(page, `${site.origin}/recipes/`);
	await statusText(page, SAVED);
	await page.waitForFunction(() => navigator.serviceWorker.controller);
}
async function openAndSave(page, id, release = RELEASE_A) {
	await navigateHydrated(page, `${site.origin}/recipes/${id}/`);
	const result = await message(page, { type: "SAVE_RECIPE", id, release });
	if (result.saved !== true) throw new Error(result.error);
}

it("Visited-only installation stores no individual recipe, pack or illustration", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const requests = [];
		context.on("request", (request) =>
			requests.push(new URL(request.url()).pathname),
		);
		const page = await context.newPage();
		await install(page);
		const before = await message(page, { type: "LIST_SAVED_RECIPES" });
		assert.deepEqual(before.recipes, []);
		assert.ok(!snapshots.A.urls.includes(`/recipes/${ID}/`));
		assert.ok(
			!snapshots.A.urls.some(
				(url) =>
					url.startsWith("/recipes/media/") ||
					url.startsWith("/recipes/data/packs/"),
			),
		);
		const cachedPaths = await page.evaluate(async () => {
			const stores = await Promise.all(
				(await caches.keys()).map((key) => caches.open(key)),
			);
			return (await Promise.all(stores.map((cache) => cache.keys())))
				.flat()
				.map((request) => new URL(request.url).pathname);
		});
		for (const path of ASSISTANT_EXPORTS) {
			assert.ok(
				!requests.includes(path),
				`${path} is never requested during installation`,
			);
			assert.ok(
				!cachedPaths.includes(path),
				`${path} is never cached during installation`,
			);
		}

		await page.locator(".recipe-card a").first().hover();
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		assert.deepEqual(
			(await message(page, { type: "LIST_SAVED_RECIPES" })).recipes,
			[],
		);
		await context.setOffline(true);
		await navigateHydrated(page, `${site.origin}/recipes/saved/`);
		await message(page, { type: "LIST_SAVED_RECIPES" });
		assert.equal(
			await page.locator(".recipe-card").count(),
			0,
			"a fresh offline installation has no saved recipes",
		);
		assert.equal(
			await page.getByRole("alert").count(),
			0,
			"the empty saved view does not need deferred search modules",
		);
		await context.setOffline(false);
		await openAndSave(page, ID);
		const saved = (await message(page, { type: "LIST_SAVED_RECIPES" })).recipes;
		assert.deepEqual(
			saved.map(({ id }) => id),
			[ID],
		);
		assert.equal(saved[0].recipe.id, ID);
		const paths = await page.evaluate(async () => {
			const name = (await caches.keys()).find((key) =>
				key.startsWith("recipe-saved-v1-"),
			);
			return (await (await caches.open(name)).keys()).map(
				(request) => new URL(request.url).pathname,
			);
		});
		for (const path of [
			`/recipes/${ID}/`,
			`/recipes/${ID}.md`,
			`/recipes/data/packs/${ID}.json`,
		])
			assert.ok(paths.includes(path), path);
		assert.equal(
			paths.filter((path) => path.startsWith("/recipes/media/")).length,
			1,
		);
		for (const path of ASSISTANT_EXPORTS) {
			assert.ok(
				!requests.includes(path),
				`${path} is never fetched when saving a recipe`,
			);
			assert.ok(
				!paths.includes(path),
				`${path} is absent from the saved bundle`,
			);
		}
	} finally {
		await context.close();
	}
});

it("Saved-only search, filters and shuffle retain their scope after a shell update", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await install(page);
		await openAndSave(page, ID);
		await openAndSave(page, OTHER);
		await navigateHydrated(page, `${site.origin}/recipes/saved/`);
		await page.waitForFunction(
			() => document.querySelectorAll(".recipe-card").length === 2,
		);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await page.locator("#recipe-update-button").click();
		await page.waitForFunction(
			(release) =>
				document.querySelector("#site-update-notice")?.dataset.release ===
				release,
			RELEASE_B,
		);
		await context.setOffline(true);
		await page.close();
		const reopened = await context.newPage();
		const requests = [];
		reopened.on("request", (request) =>
			requests.push(new URL(request.url()).pathname),
		);
		await navigateHydrated(reopened, `${site.origin}/recipes/saved/`);
		const expectIds = async (ids) => {
			await reopened.waitForFunction(
				(expected) => {
					const actual = [
						...document.querySelectorAll(".recipe-card a.title-button"),
					]
						.map((link) => link.dataset.recipeId)
						.sort((a, b) => a.localeCompare(b));
					return JSON.stringify(actual) === JSON.stringify(expected);
				},
				[...ids].sort((a, b) => a.localeCompare(b)),
			);
		};
		await expectIds([ID, OTHER]);
		const search = reopened.getByRole("searchbox", { name: "Search recipes" });
		await search.fill("asparagus");
		await expectIds([ID]);
		await search.fill("shawarma");
		await expectIds([OTHER]);
		// Pesto cod is a real collection recipe that was never opened or saved.
		await search.fill("pesto cod zucchini");
		await expectIds([]);
		await search.fill("");
		await expectIds([ID, OTHER]);
		await reopened.getByRole("button", { name: PROTEINS }).click();
		await reopened.getByRole("checkbox", { name: "Fish", exact: true }).check();
		await expectIds([ID]);
		await reopened
			.getByRole("checkbox", { name: "Fish", exact: true })
			.uncheck();
		await reopened.keyboard.press("Escape");
		await expectIds([ID, OTHER]);
		const before = await reopened
			.locator(".recipe-card a.title-button")
			.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
		await reopened.evaluate(
			(seed) => {
				crypto.randomUUID = () => seed;
			},
			before[0] === ID ? "0" : "2",
		);
		await reopened
			.getByRole("button", { name: "Shuffle meals", exact: true })
			.click();
		await reopened.waitForFunction(
			(prior) =>
				JSON.stringify(
					[...document.querySelectorAll(".recipe-card a.title-button")].map(
						(link) => link.dataset.recipeId,
					),
				) !== JSON.stringify(prior),
			before,
		);
		await expectIds([ID, OTHER]);
		assert.equal(await reopened.getByRole("alert").count(), 0);
		assert.ok(
			!requests.includes("/api/recipe-browse/"),
			"offline controls never request the full collection API",
		);
		assert.ok(
			!requests.some((path) => path.startsWith("/recipes/data/packs/")),
			"offline controls read only completed saved records",
		);
		const records = (await message(reopened, { type: "LIST_SAVED_RECIPES" }))
			.recipes;
		assert.deepEqual(
			records.map(({ id }) => id).sort((a, b) => a.localeCompare(b)),
			[ID, OTHER].sort((a, b) => a.localeCompare(b)),
		);
		assert.ok(
			records.every(({ release }) => release === RELEASE_A),
			"updating the shell does not refresh saved recipe snapshots",
		);
	} finally {
		await context.close();
	}
});

it("A mixed-release recipe save fails atomically and preserves existing saved recipes", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await install(page);
		await openAndSave(page, ID);
		await serve("B");
		const failed = await message(page, {
			type: "SAVE_RECIPE",
			id: OTHER,
			release: RELEASE_A,
		});
		assert.equal(failed.saved, false);
		assert.match(failed.error, SAVE_ERROR);
		assert.deepEqual(
			(await message(page, { type: "LIST_SAVED_RECIPES" })).recipes.map(
				({ id }) => id,
			),
			[ID],
		);
		assert.equal(
			(await page.evaluate(() => caches.keys())).filter((name) =>
				name.startsWith("recipe-saved-v1-"),
			).length,
			1,
		);
	} finally {
		await context.close();
	}
});

it("Saved recipe survives a shell update and closing every recipe tab without mixing releases", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await install(page);
		await openAndSave(page, ID);
		await navigateHydrated(page, `${site.origin}/recipes/`);
		const oldView = await context.newPage();
		await navigateHydrated(oldView, `${site.origin}/recipes/saved/`);
		await oldView.locator(".recipe-card").first().waitFor();
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await page.locator("#recipe-update-button").click();
		await page.waitForFunction(
			(release) =>
				document.querySelector("#site-update-notice")?.dataset.release ===
				release,
			RELEASE_B,
		);
		await context.setOffline(true);
		assert.equal(
			// Keep native import inside the browser; Vite must not rewrite it for Node.
			await oldView.evaluate(
				'import("/_astro/recipe-summary.pwa-A.js").then((module) => module.label)',
			),
			"Saved view A",
		);
		await navigateHydrated(page, `${site.origin}/recipes/saved/`);
		await page.locator(".recipe-card").first().waitFor();
		assert.equal(
			await page.evaluate(
				'import("/_astro/recipe-summary.pwa-B.js").then((module) => module.label)',
			),
			"Saved view B",
		);
		assert.equal(
			(await message(page, { type: "LIST_SAVED_RECIPES" })).recipes[0].release,
			RELEASE_A,
		);
		await oldView.close();
		await page.close();
		const reopened = await context.newPage();
		await navigateHydrated(reopened, `${site.origin}/recipes/${ID}/`);
		assert.equal(
			await reopened
				.locator("#site-update-notice")
				.getAttribute("data-release"),
			RELEASE_A,
		);
		const pack = await reopened.evaluate(
			async (id) => (await fetch(`/recipes/data/packs/${id}.json`)).json(),
			ID,
		);
		assert.equal(pack.releaseId, RELEASE_A);
		assert.equal(pack.recipe.id, ID);
		assert.equal(
			(await message(reopened, { type: "LIST_SAVED_RECIPES" })).recipes.length,
			1,
		);
	} finally {
		await context.close();
	}
});

it("Saved recipe and its cooking dependencies survive a browser restart", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const profile = await mkdtemp(join(tmpdir(), "recipes-saved-profile-"));
	let context;
	try {
		context = await chromium.launchPersistentContext(profile, {
			headless: true,
		});
		const page = await context.newPage();
		await install(page);
		await openAndSave(page, ID);
		await context.close();
		context = await chromium.launchPersistentContext(profile, {
			headless: true,
			offline: true,
		});
		const reopened = await context.newPage();
		await navigateHydrated(reopened, `${site.origin}/recipes/saved/`);
		await reopened.locator(".recipe-card").first().scrollIntoViewIfNeeded();
		await reopened.waitForFunction(() =>
			[...document.querySelectorAll(".card-photo img")].every(
				(image) => image.complete && image.naturalWidth > 0,
			),
		);
		await reopened
			.getByRole("link", {
				name: "Open recipe: Lemon salmon and asparagus",
				exact: true,
			})
			.click();
		await reopened.locator(".recipe-detail .reset-checks:visible").waitFor();
		await navigateHydrated(reopened, `${site.origin}/recipes/${ID}/`);
		assert.equal(
			await reopened
				.locator("#site-update-notice")
				.getAttribute("data-release"),
			RELEASE_A,
		);
		await reopened.locator(".recipe-detail .reset-checks:visible").waitFor();
		assert.equal(
			(await message(reopened, { type: "LIST_SAVED_RECIPES" })).recipes[0].id,
			ID,
		);
	} finally {
		await context?.close();
		await rm(profile, { recursive: true, force: true });
	}
});

it("A quota-exhausted save reports failure and preserves the previous complete saved recipe", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await install(page);
		await openAndSave(page, ID);
		await navigateHydrated(page, `${site.origin}/recipes/`);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await page.locator("#recipe-update-button").click();
		await page.waitForFunction(
			(release) =>
				document.querySelector("#site-update-notice")?.dataset.release ===
				release,
			RELEASE_B,
		);
		const worker = context
			.serviceWorkers()
			.filter((entry) => entry.url().endsWith("/recipes/service-worker.js"))
			.at(-1);
		await worker.evaluate(() => {
			Cache.prototype.put = () =>
				Promise.reject(
					new DOMException("Storage quota exhausted", "QuotaExceededError"),
				);
		});
		const failure = await message(page, {
			type: "SAVE_RECIPE",
			id: ID,
			release: RELEASE_B,
		});
		assert.equal(failure.saved, false);
		assert.match(failure.error, SAVE_ERROR);
		const saved = (await message(page, { type: "LIST_SAVED_RECIPES" })).recipes;
		assert.deepEqual(
			saved.map(({ id }) => id),
			[ID],
		);
		assert.equal(
			saved[0].release,
			RELEASE_A,
			"quota failure retains the complete previous recipe version",
		);
		assert.equal(
			(await page.evaluate(() => caches.keys())).filter((name) =>
				name.startsWith("recipe-saved-v1-"),
			).length,
			1,
			"the failed partial bundle is removed",
		);
		await context.setOffline(true);
		await navigateHydrated(page, `${site.origin}/recipes/${ID}/`);
		await page.locator(".recipe-detail .reset-checks:visible").waitFor();
		await stopRecipeWorkers(context);
		assert.equal(
			await page.evaluate(
				'import("/_astro/recipe-summary.pwa-A.js").then((module) => module.label)',
			),
			"Saved view A",
		);
		assert.equal(
			await page.evaluate(
				async (id) =>
					(
						await (
							await fetch(`/recipes/data/packs/${id}.json`, {
								headers: { "X-Recipe-Release": "a".repeat(40) },
							})
						).json()
					).releaseId,
				ID,
			),
			RELEASE_A,
		);
	} finally {
		await context.close();
	}
});
