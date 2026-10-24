import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { it } from "vitest";
import {
	browser,
	navigateHydrated,
	SAVED,
	serve,
	setupRecipePwaFixture,
	site,
	snapshots,
	statusText,
	stopRecipeWorkers,
} from "./recipes-pwa-fixture.mjs";

setupRecipePwaFixture();

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
const archivedRecipes = JSON.parse(
	await readFile(
		new URL(
			"../../docs/recipes-archive/keto-2026-10-23/recipes.json",
			import.meta.url,
		),
		"utf8",
	),
).recipes;
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

it("Retired saved recipes still negotiate HTML, Markdown and unsupported Accept offline", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await install(page);
		await openAndSave(page, ID);
		await navigateHydrated(page, `${site.origin}/recipes/`);
		const recipe = archivedRecipes.find(({ id }) => id === "carrot-cake");
		const original = await page.evaluate(
			async ({ recipe: savedRecipe, release }) => {
				const id = savedRecipe.id;
				const paths = [
					`/recipes/${id}/`,
					`/recipes/${id}.md`,
					`/recipes/data/packs/${id}.json`,
				];
				const html =
					// biome-ignore lint/security/noSecrets: synthetic archived recipe HTML, not a credential.
					"<html><body><main><h1>Archived carrot cake</h1><p>Legacy cooking record.</p></main></body></html>";
				const markdown =
					"# Archived carrot cake\n\nLegacy ingredients and method.\n";
				const cache = `recipe-saved-v1-${release}-${id}-fixture`;
				const store = await caches.open(cache);
				await Promise.all(
					[
						[paths[0], "text/html", html],
						[paths[1], "text/markdown", markdown],
						[
							paths[2],
							"application/json",
							JSON.stringify({
								schemaVersion: 1,
								releaseId: release,
								recipe: savedRecipe,
							}),
						],
					].map(([path, type, body]) =>
						store.put(
							new Request(new URL(path, location.origin), {
								headers: {
									accept: path.endsWith("/")
										? "text/html"
										: path.endsWith(".md")
											? "text/markdown"
											: "*/*",
								},
							}),
							new Response(body, {
								headers: { "content-type": type, vary: "Accept" },
							}),
						),
					),
				);
				const registry = await caches.open("recipe-saved-registry-v1");
				const registryKey = new URL(
					"/recipes/__saved_recipes__",
					location.origin,
				).href;
				const saved = await (await registry.match(registryKey)).json();
				saved.recipes[id] = { id, release, cache, savedAt: Date.now(), paths };
				await registry.put(registryKey, Response.json(saved));
				return { html, markdown, cache, id };
			},
			{ recipe, release: RELEASE_B },
		);
		assert.deepEqual(
			(await message(page, { type: "LIST_SAVED_RECIPES" })).recipes.map(
				({ id }) => id,
			),
			[ID, recipe.id],
		);
		await context.setOffline(true);
		const results = await page.evaluate(
			async (id) =>
				Promise.all(
					[
						[`/recipes/${id}/`, "text/html", "GET"],
						[`/recipes/${id}/`, "text/markdown", "GET"],
						[`/recipes/${id}.md`, "text/html", "GET"],
						[`/recipes/${id}/`, "text/markdown", "HEAD"],
						[`/recipes/${id}/`, "application/json", "GET"],
						[`/recipes/${id}/`, "application/json", "HEAD"],
					].map(async ([path, accept, method]) => {
						const response = await fetch(path, { method, headers: { accept } });
						return {
							status: response.status,
							type: response.headers.get("content-type"),
							vary: response.headers.get("vary"),
							body: await response.text(),
						};
					}),
				),
			recipe.id,
		);
		assert.equal(results[0].status, 200);
		assert.equal(results[0].type, "text/html");
		assert.ok(results[0].body.includes("<html>"));
		assert.ok(results[0].body.includes("saved recipe from an earlier version"));
		for (const result of [results[1], results[2]]) {
			assert.equal(result.status, 200);
			assert.equal(result.type, "text/markdown");
			assert.ok(result.body.includes(original.markdown));
			assert.ok(!result.body.includes("<html>"));
			assert.equal(result.vary, "Accept");
		}
		assert.equal(results[1].body, results[2].body);
		assert.equal(results[3].status, 200);
		assert.equal(results[3].type, "text/markdown");
		assert.equal(results[3].body, "");
		for (const result of [results[4], results[5]]) {
			assert.equal(result.status, 406);
			assert.equal(result.vary, "Accept");
		}
		assert.equal(results[5].body, "");
		const stored = await page.evaluate(async ({ cache, id }) => {
			const store = await caches.open(cache);
			return Promise.all(
				[
					[`/recipes/${id}/`, "text/html"],
					[`/recipes/${id}.md`, "text/markdown"],
				].map(async ([path, accept]) =>
					(
						await store.match(
							new Request(new URL(path, location.origin), {
								headers: { accept },
							}),
						)
					).text(),
				),
			);
		}, original);
		assert.deepEqual(stored, [original.html, original.markdown]);
		await navigateHydrated(page, `${site.origin}/recipes/saved/`);
		await page
			.locator(`.recipe-card .title-button[data-recipe-id="${ID}"]`)
			.waitFor();
		assert.equal(
			await page.locator(".recipe-card").count(),
			1,
			"the retired saved record remains stored but outside keto browsing",
		);
	} finally {
		await context.close();
	}
});

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
		await reopened.waitForURL((url) => url.pathname === `/recipes/${ID}/`);
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
