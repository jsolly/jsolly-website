import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, it } from "vitest";
import { buildRecipePwa } from "../recipes/pwa-build.mjs";
import { collectErrors, readBuilt } from "./pages.mjs";
import { legacyUnits, setLegacyUnits } from "./recipe-legacy-units.mjs";
import {
	browser,
	controlled,
	DATA_FILES,
	dataLabel,
	INSTRUCTIONS,
	LANDING,
	LEARN_MORE,
	MANIFEST_LINK,
	navigateHydrated,
	noUpdateWaiting,
	OFFLINE,
	RECIPE_PAGES,
	SAVED,
	SCOPE,
	SERVINGS,
	SHARED_RECIPE,
	serve,
	setupRecipePwaFixture,
	site,
	snapshotLabel,
	snapshots,
	statuses,
	statusText,
	VIEWPORTS,
	WORKER,
	waitForBrowserState,
} from "./recipes-pwa-fixture.mjs";

setupRecipePwaFixture(["broken", "maintenance"]);

// Rebuilding unchanged A and B must preserve the actual generated worker.
// These build-time checks run once here; update/integrity files need only
// their independently generated snapshots, not duplicate determinism work.
const rebuiltWorkers = new Map();
beforeAll(async () => {
	for (const label of ["A", "B"]) {
		const snapshot = snapshots[label];
		// biome-ignore lint/performance/noAwaitInLoops: each snapshot owns its build outputs.
		await buildRecipePwa(snapshot.directory);
		rebuiltWorkers.set(
			label,
			await readFile(join(snapshot.directory, WORKER), "utf8"),
		);
	}
});

function saveVisited(page, id) {
	return page.evaluate(
		(recipeId) =>
			new Promise((resolve, reject) => {
				const channel = new MessageChannel();
				const timer = setTimeout(
					() => reject(new Error("Save timed out")),
					30_000,
				);
				channel.port1.onmessage = ({ data }) => {
					clearTimeout(timer);
					channel.port1.close();
					if (data.saved) resolve();
					else reject(new Error(data.error));
				};
				navigator.serviceWorker.controller.postMessage(
					{ type: "SAVE_RECIPE", id: recipeId, release: "a".repeat(40) },
					[channel.port2],
				);
			}),
		id,
	);
}
function installCheck(name, viewport) {
	it(`Recipe PWA installs and visited cooking tools work offline on ${name}`, {
		timeout: 90_000,
	}, async () => {
		for (const label of ["A", "B"])
			assert.equal(
				rebuiltWorkers.get(label),
				snapshots[label].worker,
				`${label}: deterministic worker`,
			);
		await serve("A");
		const { urls } = snapshots.A;
		assert.deepEqual(urls, [...urls].sort());
		assert.ok(urls.includes(LANDING));
		assert.ok(urls.includes("/recipes/saved/"));
		assert.ok(
			!urls.some(
				(url) =>
					url.startsWith("/recipes/media/") ||
					url.startsWith("/recipes/data/packs/"),
			),
		);
		for (const path of RECIPE_PAGES.filter(
			(page) => ![LANDING, "/recipes/saved/"].includes(page),
		))
			assert.ok(
				!urls.includes(path),
				`${path} is not installed without a visit`,
			);
		assert.equal(urls.includes(WORKER), false);
		const fallbackStyles = await readBuilt(LANDING, (document) =>
			[...document.querySelectorAll("noscript link[rel=stylesheet]")].map(
				(link) => link.getAttribute("href"),
			),
		);
		assert.ok(fallbackStyles.length > 0);
		for (const href of fallbackStyles) assert.ok(urls.includes(href));
		const context = await browser.newContext({ viewport });
		try {
			const page = await context.newPage();
			await page.addInitScript(() =>
				sessionStorage.setItem(
					"pwaNavigations",
					String(Number(sessionStorage.getItem("pwaNavigations") ?? 0) + 1),
				),
			);
			await navigateHydrated(page, `${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
			assert.equal(
				await page.evaluate(() => sessionStorage.getItem("pwaNavigations")),
				"1",
				"first install does not reload",
			);
			const metadata = await page.evaluate(async (selector) => {
				const manifest = await (
					await fetch(document.querySelector(selector).href)
				).json();
				const registration = await navigator.serviceWorker.getRegistration();
				return {
					manifest,
					scope: registration.scope,
					script: registration.active.scriptURL,
				};
			}, MANIFEST_LINK);
			assert.equal(metadata.manifest.id, SCOPE);
			assert.equal(metadata.manifest.scope, SCOPE);
			assert.equal(metadata.manifest.start_url, SCOPE);
			assert.equal(metadata.manifest.display, "standalone");
			assert.equal(metadata.scope, `${site.origin}${SCOPE}`);
			assert.equal(metadata.script, `${site.origin}${WORKER}`);
			assert.deepEqual(
				await statuses(
					page,
					metadata.manifest.icons.map(({ src }) => src),
				),
				[200, 200],
			);
			for (const id of [
				"lemon-salmon-and-asparagus",
				"shawarma-chicken-bowls",
			]) {
				// biome-ignore lint/performance/noAwaitInLoops: each explicit visit must complete its own atomic save.
				await navigateHydrated(page, `${site.origin}/recipes/${id}/`);
				await saveVisited(page, id);
			}
			await setLegacyUnits(page, "grams");
			await page.addInitScript(() => {
				if (location.pathname !== "/recipes/saved/") return;
				const postMessage = ServiceWorker.prototype.postMessage;
				ServiceWorker.prototype.postMessage = new Proxy(postMessage, {
					apply(target, worker, args) {
						if (args[0]?.type !== "LIST_SAVED_RECIPES")
							return Reflect.apply(target, worker, args);
						// Hold the real storage read at a deterministic boundary: Astro
						// hydration does not wait for the asynchronous saved collection.
						window.releaseSavedList = () => {
							ServiceWorker.prototype.postMessage = postMessage;
							Reflect.apply(target, worker, args);
						};
					},
				});
			});
			await context.setOffline(true);
			await navigateHydrated(page, `${site.origin}/recipes/saved/`);
			await page.locator(".meal-library[data-hydrated=true]").waitFor();
			await page.waitForFunction(
				() => typeof window.releaseSavedList === "function",
			);
			assert.equal(
				await page.locator(".recipe-card").count(),
				0,
				"hydration can finish before the saved registry responds",
			);
			await page.evaluate(() => window.releaseSavedList());
			const savedIds = ["lemon-salmon-and-asparagus", "shawarma-chicken-bowls"];
			await page.waitForFunction((expected) => {
				const actual = [
					...document.querySelectorAll(".recipe-card a.title-button"),
				]
					.map((link) => link.dataset.recipeId)
					.sort((a, b) => a.localeCompare(b));
				return JSON.stringify(actual) === JSON.stringify(expected);
			}, savedIds);
			assert.deepEqual(
				await page
					.locator(".recipe-card a.title-button")
					.evaluateAll((links) =>
						links
							.map((link) => link.dataset.recipeId)
							.sort((a, b) => a.localeCompare(b)),
					),
				savedIds,
				"offline view includes only the two opened recipes",
			);
			assert.equal(await legacyUnits(page), "grams");
			await statusText(page, OFFLINE);
			await navigateHydrated(page, `${site.origin}${SHARED_RECIPE}`);
			await page.locator(".recipe-detail .reset-checks:visible").waitFor();
			assert.equal(
				await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
				"8",
			);
			assert.ok(await page.locator(".recipe-detail .trn-table").count());
			await page.waitForFunction(() =>
				[...document.querySelectorAll(".recipe-detail img")].every(
					(image) => image.complete && image.naturalWidth > 0,
				),
			);
			await page.getByRole("button", { name: LEARN_MORE, exact: true }).click();
			await page.locator(".method-dialog").waitFor();
			await page
				.getByRole("button", { name: "Close and continue recipe" })
				.click();
			const failed = await page.evaluate(() =>
				Promise.all(
					[
						"/blog/",
						`/recipes/meals/?${new URLSearchParams({ browse: "1", q: "salmon" })}`,
					].map((path) =>
						fetch(path).then(
							() => false,
							() => true,
						),
					),
				),
			);
			assert.deepEqual(
				failed,
				[true, true],
				"external pages and native form submissions need a connection",
			);
			await navigateHydrated(page, `${site.origin}/recipes/smoothies/`);
			assert.equal(
				new URL(page.url()).pathname,
				"/recipes/saved/",
				"unsaved collection navigations show saved recipes offline",
			);
			await context.setOffline(false);
			for (const path of ["/blog/", "/about/"]) {
				// biome-ignore lint/performance/noAwaitInLoops: verify each navigation's scope independently.
				await navigateHydrated(page, `${site.origin}${path}`);
				assert.equal(await controlled(page), false);
			}
		} finally {
			await context.close();
		}
	});
}

for (const [name, viewport] of VIEWPORTS) installCheck(name, viewport);

it("An installed worker serves offline HTML when the cached request has a different Accept header", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	try {
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		// Keep a cached navigation carrying its HTML Accept. A bare Cache.match
		// must miss this Vary response, so the worker must look up the explicit
		// HTML representation instead of treating every Accept variant alike.
		const cacheState = await page.evaluate(
			async ({ cache, path }) => {
				const store = await caches.open(cache);
				const url = new URL(path, location.origin).href;
				const response = await store.match(
					new Request(url, { headers: { Accept: "text/html" } }),
				);
				if (!response)
					throw new Error("Installed snapshot has no landing page");
				const vary = response.headers.get("Vary");
				await store.delete(url);
				await store.put(
					new Request(url, { headers: { Accept: "text/html" } }),
					response,
				);
				return {
					vary,
					bareMatch: Boolean(await store.match(url)),
					htmlMatch: Boolean(
						await store.match(
							new Request(url, { headers: { Accept: "text/html" } }),
						),
					),
				};
			},
			{ cache: snapshots.A.cache, path: LANDING },
		);
		assert.deepEqual(cacheState, {
			vary: "Accept",
			bareMatch: false,
			htmlMatch: true,
		});
		await context.setOffline(true);
		await navigateHydrated(page);
		await statusText(page, OFFLINE);
		assert.equal(await snapshotLabel(page), "A");
		await page.locator(".meal-library[data-hydrated=true]").waitFor();
		const servings = page.getByRole("combobox", { name: SERVINGS });
		await servings.selectOption("2");
		assert.equal(await page.locator(".recipe-card").count(), 0);
		assert.equal(await page.getByRole("alert").count(), 0);
		assert.equal(await servings.inputValue(), "2");
		assert.deepEqual(await statuses(page, DATA_FILES), [200, 200]);
	} finally {
		await context.close();
	}
});

it("Distinct snapshot update waits for both tabs, then serves new recipes offline", {
	timeout: 90_000,
}, async () => {
	assert.notEqual(snapshots.A.cache, snapshots.B.cache);
	await serve("A");
	const context = await browser.newContext();
	try {
		const tabs = [await context.newPage(), await context.newPage()];
		const observations = tabs.map((page) => {
			const errors = collectErrors(page, { warnings: true });
			const failedRequests = [];
			page.on("requestfailed", (request) => {
				failedRequests.push({
					url: request.url(),
					type: request.resourceType(),
					error: request.failure()?.errorText,
				});
			});
			return { errors, failedRequests };
		});
		for (const page of tabs) {
			// biome-ignore lint/performance/noAwaitInLoops: the tabs open in turn
			await navigateHydrated(page, `${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
			assert.equal(await snapshotLabel(page), "A");
		}
		// Observe activation from outside the worker's scope. Reopening a
		// recipe tab before B activates can keep A alive and prevent the swap.
		const reopened = await context.newPage();
		await navigateHydrated(reopened, `${site.origin}/about/`);
		assert.equal(await controlled(reopened), false);
		await serve("B");
		await tabs[0].evaluate(async () => {
			await (await navigator.serviceWorker.getRegistration()).update();
		});
		try {
			await tabs[0]
				.locator("#recipe-offline-status")
				.filter({ hasText: "The updated app is ready" })
				.waitFor({ state: "visible" });
		} catch (error) {
			let diagnosticTimer;
			let details;
			try {
				const capture = Promise.all(
					tabs.map(async (page, index) => ({
						...observations[index],
						...(await page.evaluate(async () => {
							const registration =
								await navigator.serviceWorker.getRegistration();
							const worker = (value) =>
								value
									? { state: value.state, scriptURL: value.scriptURL }
									: null;
							const status = document.querySelector("#recipe-offline-status");
							const cachedIdentities = await Promise.all(
								(await caches.keys()).map(async (cache) => {
									const [identity, ownership] = await Promise.all([
										caches.match("/recipes/__snapshot_identity__", {
											cacheName: cache,
										}),
										caches.match("/recipes/__snapshot_owners__", {
											cacheName: cache,
										}),
									]);
									return {
										cache,
										identity: identity ? await identity.json() : null,
										ownership: ownership ? await ownership.json() : null,
									};
								}),
							);
							return {
								url: location.href,
								status: status?.textContent,
								statusHidden: status?.closest(".recipe-pwa")?.hidden,
								targetRelease: status?.dataset.target,
								loadedRelease: document.querySelector("#site-update-notice")
									?.dataset.release,
								installing: worker(registration?.installing),
								waiting: worker(registration?.waiting),
								active: worker(registration?.active),
								controller: worker(navigator.serviceWorker.controller),
								cachedIdentities: cachedIdentities.filter(
									(entry) => entry.identity || entry.ownership,
								),
							};
						})),
					})),
				);
				const diagnostics = await Promise.race([
					capture,
					new Promise((_, reject) => {
						diagnosticTimer = setTimeout(
							() => reject(new Error("capture exceeded its 2000ms budget")),
							2000,
						);
					}),
				]);
				details = `Recipe update readiness diagnostics: ${JSON.stringify(diagnostics)}`;
			} catch (diagnosticError) {
				details = `Recipe update readiness diagnostics failed: ${diagnosticError.message}`;
			} finally {
				clearTimeout(diagnosticTimer);
			}
			error.message += `\n${details}`;
			error.stack += `\n${details}`;
			throw error;
		}
		await context.setOffline(true);
		for (const page of tabs) {
			// biome-ignore lint/performance/noAwaitInLoops: the tabs reload in turn
			await navigateHydrated(page);
			assert.equal(await snapshotLabel(page), "A");
			assert.equal(await dataLabel(page), "A");
		}
		await tabs[0].close();
		assert.equal(
			await tabs[1].evaluate(
				async () =>
					(await navigator.serviceWorker.getRegistration()).waiting.state,
			),
			"installed",
		);
		assert.ok(
			(await tabs[1].evaluate(() => caches.keys())).includes(snapshots.A.cache),
		);
		await tabs[1].close();
		// No online recipe visit is needed: the observer stays outside the
		// scope until B has activated and retired A's cache.
		await waitForBrowserState(
			reopened,
			async (cache) => {
				const registration =
					await navigator.serviceWorker.getRegistration("/recipes/");
				const keys = (await caches.keys()).filter(
					(key) => key !== "recipe-pages-pwa-ownership",
				);
				return (
					registration?.active?.state === "activated" &&
					!registration.waiting &&
					keys.includes(cache)
				);
			},
			snapshots.B.cache,
		);
		await navigateHydrated(reopened, `${site.origin}${LANDING}`);
		assert.equal(await snapshotLabel(reopened), "B");
		assert.equal(await dataLabel(reopened), "B");
		assert.deepEqual(
			await reopened.evaluate(async () =>
				(await caches.keys()).filter(
					(key) => key !== "recipe-pages-pwa-ownership",
				),
			),
			[snapshots.A.cache, snapshots.B.cache],
		);
		await reopened.getByRole("combobox", { name: SERVINGS }).selectOption("6");
	} finally {
		await context.close();
	}
});

it("A maintenance deploy or a failed replacement keeps the previous offline snapshot, and the failed download reports failure", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.clock.install();
		const consoleErrors = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		// A maintenance deploy has no worker: the update check 404s and the
		// installed app keeps its worker, its cache and its offline copy.
		await serve("maintenance");
		assert.equal(
			await page.evaluate(async () => {
				const registration = await navigator.serviceWorker.getRegistration();
				return registration.update().then(
					() => "updated",
					() => "rejected",
				);
			}),
			"rejected",
			"the update check against a maintenance deploy",
		);
		assert.equal(await controlled(page), true);
		assert.ok(
			(await page.evaluate(() => caches.keys())).includes(snapshots.A.cache),
			"snapshot A's cache survives the maintenance deploy",
		);
		await context.setOffline(true);
		await navigateHydrated(page);
		assert.equal(await snapshotLabel(page), "A");
		await context.setOffline(false);
		await navigateHydrated(page);
		await page.clock.fastForward(60_000);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await statusText(page, "Could not check for recipe updates.");
		assert.equal(await dataLabel(page), "A");

		await serve("broken");
		await page.evaluate(async () => {
			await (await navigator.serviceWorker.getRegistration()).update();
		});
		await statusText(page, "Update download failed.");
		assert.ok(
			consoleErrors.some((text) =>
				text.includes("Recipe update download failed:"),
			),
			"a failed replacement emits an error-level diagnostic",
		);
		await context.setOffline(true);
		await navigateHydrated(page);
		await statusText(page, OFFLINE);
		assert.equal(await snapshotLabel(page), "A");
		assert.equal(await dataLabel(page), "A");
		await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
		assert.equal(await noUpdateWaiting(page), true);
	} finally {
		await context.close();
	}
});

// The production smoke runner blocks service workers (Playwright's
// serviceWorkers: "block", whose register() resolves with no registration)
// and fails on any console error, so the library must hydrate there cleanly,
// with the install instructions, not a failed download, in its status line.
it("Recipe library hydrates without errors when the browser blocks service workers", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		const page = await context.newPage();
		const errors = collectErrors(page);
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await page.locator(".meal-library[data-hydrated=true]").waitFor();
		assert.ok(
			(await page.locator(".meal-library .recipe-card:visible").count()) > 0,
			"the library shows recipe cards",
		);
		assert.equal(
			await page.locator("#recipe-offline-status").textContent(),
			INSTRUCTIONS,
		);
		assert.deepEqual(errors, [], "no console or page errors");
	} finally {
		await context.close();
	}
});

it("Failed first download does not claim offline readiness", {
	timeout: 90_000,
}, async () => {
	await serve("broken");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, "Recipes could not be saved offline.");
		assert.equal(await controlled(page), false);
	} finally {
		await context.close();
	}
});

it("Offline page requests select separate HTML and Markdown representations and preserve static downloads", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await navigateHydrated(
			page,
			`${site.origin}/recipes/lemon-salmon-and-asparagus/`,
		);
		await saveVisited(page, "lemon-salmon-and-asparagus");
		await context.setOffline(true);
		const results = await page.evaluate((markerPath) => {
			return Promise.all(
				[
					["/recipes/", "text/html", "GET"],
					["/recipes/", "text/markdown", "GET"],
					["/recipes/", "text/markdown", "HEAD"],
					["/recipes/", "application/json", "GET"],
					["/recipes/", "application/json", "HEAD"],
					["/recipes/lemon-salmon-and-asparagus.md", "text/html", "GET"],
					[
						"/recipes/lemon-salmon-and-asparagus/?servings=8",
						"text/markdown",
						"GET",
					],
					[markerPath, "application/json", "GET"],
				].map(async ([path, accept, method]) => {
					const response = await fetch(path, { method, headers: { accept } });
					return {
						status: response.status,
						type: response.headers.get("content-type"),
						vary: response.headers.get("vary"),
						body: await response.text(),
					};
				}),
			);
		}, DATA_FILES[1]);
		for (const [index, type] of [
			[0, "text/html"],
			[1, "text/markdown"],
			[2, "text/markdown"],
			[5, "text/markdown"],
			[6, "text/markdown"],
			[7, "text/markdown"],
		]) {
			assert.equal(results[index].status, 200, `response ${index} succeeds`);
			assert.equal(
				results[index].type.split(";")[0],
				type,
				`response ${index} MIME`,
			);
			assert.ok(
				results[index].vary
					.split(",")
					.map((value) => value.trim())
					.includes("Accept"),
				`response ${index} respects its cached Vary`,
			);
		}
		assert.equal(results[0].status, 200);
		assert.ok(results[0].body.includes("<html"));
		assert.equal(results[1].status, 200);
		assert.ok(results[1].body.includes("Keto meals & smoothies"));
		assert.ok(!results[1].body.includes("<html"));
		assert.equal(results[2].body, "");
		assert.equal(results[3].status, 406);
		assert.equal(results[3].vary, "Accept");
		assert.equal(results[4].status, 406);
		assert.equal(results[4].vary, "Accept");
		assert.equal(results[4].body, "");
		assert.ok(results[5].body.includes("Lemon salmon and asparagus"));
		assert.equal(
			results[5].body,
			results[6].body,
			"query controls do not change the canonical Markdown",
		);
		assert.equal(
			results[7].status,
			200,
			"static marker accepts a rejected page Accept",
		);
		assert.equal(
			results[7].body,
			await readFile(join(snapshots.A.directory, DATA_FILES[1]), "utf8"),
			"static marker retains its exact built body",
		);
	} finally {
		await context.close();
	}
});
