import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "vitest";
import { RECIPE_BROWSE_LOCK } from "../../src/components/recipes/recipe-browse-coordination.mjs";
import recipeData from "../../src/components/recipes/recipe-data.server.mjs";
import { streamBrowseResponse } from "./recipe-browse-stream-proxy.mjs";
import {
	browser,
	dataLabel,
	LANDING,
	navigateHydrated,
	serve,
	setupRecipePwaFixture,
	site,
	snapshotLabel,
	snapshots,
	waitForBrowserState,
} from "./recipes-pwa-fixture.mjs";

setupRecipePwaFixture(["legacy"]);

const MODULE = "/recipes/browse-coordination-probe.mjs";
const PROTEINS = /^Proteins:/u;
const source = await readFile(
	new URL(
		"../../src/components/recipes/recipe-browse-coordination.mjs",
		import.meta.url,
	),
	"utf8",
);
const api = (extra = {}) =>
	`/api/recipe-browse/?${new URLSearchParams({ path: "/recipes/meals/", browse: "1", release: "a".repeat(40), ...extra })}`;

async function probeModule(context, page) {
	await context.route(`**${MODULE}`, (route) =>
		route.fulfill({ contentType: "text/javascript", body: source }),
	);
	await page.evaluate(
		`import(${JSON.stringify(MODULE)}).then(module => { window.coordination = module; })`,
	);
}

function startBrowse(page, url, name) {
	return page.evaluate(
		({ url: requestURL, name: promiseName }) => {
			window[promiseName] = window.coordination.withRecipeBrowse(
				undefined,
				async () => {
					const response = await fetch(requestURL, {
						headers: { Accept: "application/json" },
					});
					return { status: response.status, body: await response.json() };
				},
			);
		},
		{ url, name },
	);
}

it("Legacy activation drains a browse body before retiring A and queues the other tab's next request", {
	timeout: 90_000,
}, async () => {
	await serve("legacy");
	const proxy = await streamBrowseResponse(
		site.origin,
		(url) =>
			url.pathname === "/api/recipe-browse/" &&
			url.searchParams.getAll("proteinChoice").includes("fish"),
	);
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		const other = await context.newPage();
		for (const tab of [page, other]) {
			// biome-ignore lint/performance/noAwaitInLoops: establish both real legacy-controlled clients before the update.
			await navigateHydrated(tab, `${proxy.origin}${LANDING}`);
			await tab.waitForFunction(() => navigator.serviceWorker.controller);
		}
		await probeModule(context, other);
		await page.evaluate(() => {
			window.activationMessages = 0;
			const post = ServiceWorker.prototype.postMessage;
			ServiceWorker.prototype.postMessage = function (...args) {
				if (args[0]?.type === "ACTIVATE_RECIPE_UPDATE")
					window.activationMessages++;
				// biome-ignore lint/nursery/noThisOutsideOfClass: observe the real native activation message.
				return post.apply(this, args);
			};
		});
		await other.getByRole("button", { name: PROTEINS }).click();
		await other.getByRole("checkbox", { name: "Fish", exact: true }).check();
		await other.keyboard.press("Escape");
		const held = await proxy.started;
		const expected = recipeData.recipes
			.filter(
				(recipe) => recipe.type === "meal" && recipe.proteinType === "fish",
			)
			.map((recipe) => recipe.id);
		assert.equal(held.status, 200);
		assert.equal(held.body.release, "a".repeat(40));
		assert.equal(held.body.total, expected.length);
		assert.ok(held.body.cards.every((card) => expected.includes(card.id)));
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		const update = page.locator("#recipe-update-button");
		await update.waitFor({ state: "visible" });
		await update.click();
		await waitForBrowserState(
			other,
			async (name) =>
				(await navigator.locks.query()).pending.some(
					(lock) => lock.name === name && lock.mode === "exclusive",
				),
			RECIPE_BROWSE_LOCK,
		);
		assert.equal(
			await page.evaluate(() => window.activationMessages),
			0,
			"headers alone cannot release the shared browse lock",
		);
		await startBrowse(other, api({ queued: "1" }), "queuedBrowse");
		await waitForBrowserState(
			other,
			async (name) =>
				(await navigator.locks.query()).pending.some(
					(lock) => lock.name === name && lock.mode === "shared",
				),
			RECIPE_BROWSE_LOCK,
		);
		assert.ok(
			!proxy.requests.some((url) => url.includes("queued=1")),
			"queued browse has not reached the server",
		);
		proxy.release();
		await other.waitForFunction(
			(ids) =>
				JSON.stringify(
					[...document.querySelectorAll(".recipe-card .title-button")].map(
						(link) => link.dataset.recipeId,
					),
				) === JSON.stringify(ids),
			held.body.cards.map((card) => card.id),
		);
		assert.deepEqual(
			await other
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
			held.body.cards.map((card) => card.id),
		);
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		assert.deepEqual(await other.evaluate(() => window.queuedBrowse), {
			status: 409,
			body: {
				error: "Recipes have updated. Reload the collection to continue.",
				release: "b".repeat(40),
			},
		});
		await context.setOffline(true);
		assert.equal(await snapshotLabel(other), "A");
		assert.equal(await dataLabel(other), "A");
		await other.locator("#recipe-update-button").click();
		await other.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		assert.equal(await dataLabel(other), "B");
		assert.deepEqual(proxy.errors, []);
	} finally {
		proxy.release();
		await context.close();
		await proxy.close();
	}
});

it("Aborted queued browsing never fetches and aborted bodies or failed activation release their locks", {
	timeout: 30_000,
}, async () => {
	await serve("A");
	const proxy = await streamBrowseResponse(site.origin);
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.goto(`${proxy.origin}/about/`);
		await probeModule(context, page);
		await page.evaluate(() => {
			window.unlock = Promise.withResolvers();
			window.exclusive = window.coordination.withRecipeActivation(
				() => window.unlock.promise,
			);
		});
		await waitForBrowserState(
			page,
			async (name) =>
				(await navigator.locks.query()).held.some((lock) => lock.name === name),
			RECIPE_BROWSE_LOCK,
		);
		await page.evaluate(
			(url) => {
				window.cancel = new AbortController();
				window.queued = window.coordination
					.withRecipeBrowse(window.cancel.signal, () =>
						fetch(url, { signal: window.cancel.signal }),
					)
					.catch((error) => error.name);
			},
			api({ cancelled: "1" }),
		);
		await waitForBrowserState(
			page,
			async (name) =>
				(await navigator.locks.query()).pending.some(
					(lock) => lock.name === name,
				),
			RECIPE_BROWSE_LOCK,
		);
		assert.equal(
			await page.evaluate(() => {
				window.cancel.abort();
				return window.queued;
			}),
			"AbortError",
		);
		assert.ok(!proxy.requests.some((url) => url.includes("cancelled=1")));
		await page.evaluate(async () => {
			window.unlock.resolve();
			await window.exclusive;
		});
		await page.evaluate(
			(url) => {
				window.cancelBody = new AbortController();
				window.bodyRead = window.coordination
					.withRecipeBrowse(window.cancelBody.signal, async () => {
						const response = await fetch(url, {
							headers: { Accept: "application/json" },
							signal: window.cancelBody.signal,
						});
						return response.json();
					})
					.catch((error) => error.name);
			},
			api({ heldBody: "1" }),
		);
		await proxy.started;
		assert.equal(
			await page.evaluate(() => {
				window.cancelBody.abort();
				return window.bodyRead;
			}),
			"AbortError",
		);
		assert.equal(
			await page.evaluate(() =>
				window.coordination
					.withRecipeActivation(() => {
						throw new Error("activation failed");
					})
					.catch((error) => error.message),
			),
			"activation failed",
		);
		await startBrowse(page, api(), "afterFailure");
		const result = await page.evaluate(() => window.afterFailure);
		assert.equal(result.status, 200);
		assert.equal(result.body.release, "a".repeat(40));
		const locks = await page.evaluate(() => navigator.locks.query());
		assert.ok(
			![...locks.held, ...locks.pending].some(
				(lock) => lock.name === RECIPE_BROWSE_LOCK,
			),
		);
	} finally {
		proxy.release();
		await context.close();
		await proxy.close();
	}
});

it("An activation queued behind browsing revalidates a replacement waiting release", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const proxy = await streamBrowseResponse(site.origin);
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		const other = await context.newPage();
		await navigateHydrated(page, `${proxy.origin}${LANDING}`);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await other.goto(`${proxy.origin}/about/`);
		await probeModule(context, other);
		await startBrowse(other, api({ heldBody: "1" }), "heldBrowse");
		await proxy.started;
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		const update = page.locator("#recipe-update-button");
		await update.waitFor({ state: "visible" });
		assert.equal(
			await page.locator("#recipe-offline-status").getAttribute("data-target"),
			"b".repeat(40),
		);
		await update.click();
		await waitForBrowserState(
			other,
			async (name) =>
				(await navigator.locks.query()).pending.some(
					(lock) => lock.name === name && lock.mode === "exclusive",
				),
			RECIPE_BROWSE_LOCK,
		);
		await serve("C");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await waitForBrowserState(
			page,
			async (cache) => {
				const registration = await navigator.serviceWorker.getRegistration();
				const response = await caches.match("/recipes/__snapshot_owners__", {
					cacheName: "recipe-pages-pwa-ownership",
				});
				return (
					registration.waiting?.state === "installed" &&
					!registration.installing &&
					(await response?.json())?.pending?.cache === cache
				);
			},
			snapshots.C.cache,
		);
		proxy.release();
		await other.evaluate(() => window.heldBrowse);
		await page
			.getByText(
				"A different recipe update is now available. Choose Update and reload again when ready.",
				{ exact: true },
			)
			.waitFor();
		assert.equal(await snapshotLabel(page), "A");
		assert.equal(
			await page.locator("#recipe-offline-status").getAttribute("data-target"),
			"c".repeat(40),
		);
		assert.equal(await update.isEnabled(), true);
		await update.click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"C",
		);
		assert.equal(await dataLabel(page), "C");
		assert.deepEqual(proxy.errors, []);
	} finally {
		proxy.release();
		await context.close();
		await proxy.close();
	}
});
