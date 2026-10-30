import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";
import { legacyUnits, setLegacyUnits } from "./recipe-legacy-units.mjs";
import {
	browser,
	dataLabel,
	LANDING,
	navigateHydrated,
	OFFLINE,
	SAVED,
	SERVINGS,
	serve,
	setupRecipePwaFixture,
	site,
	snapshotLabel,
	snapshots,
	statusText,
	stopRecipeWorkers,
	UNSAVED_CONFIRMATION,
	VIEWPORTS,
	waitForBrowserState,
} from "./recipes-pwa-fixture.mjs";
import { assertUpdateNoticeLayout } from "./update-notice-layout.mjs";

setupRecipePwaFixture(["legacy"]);

const FETCH_FAILED = /Failed to fetch/u;

it("Live browse JSON never restarts a stopped recipe worker", {
	timeout: 30_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		// An inert controlled document isolates the request from background browse
		// batches and automatic update checks in the real app document.
		await context.route("**/recipes/cold-worker-probe/", (route) =>
			route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
		);
		await page.goto(`${site.origin}/recipes/cold-worker-probe/`);
		assert.equal(
			await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
			`${site.origin}/recipes/service-worker.js`,
		);
		const browse = () =>
			page.evaluate(async () => {
				const response = await fetch(
					`/api/recipe-browse/?path=%2Frecipes%2Fmeals%2F&browse=1&release=${"a".repeat(40)}`,
					{ headers: { Accept: "application/json" } },
				);
				return { status: response.status, body: await response.json() };
			});
		// Establish offline behavior before attaching the protocol observer or
		// stopping workers, which can interfere with emulation changes in Chromium.
		await context.setOffline(true);
		await assert.rejects(browse(), FETCH_FAILED);
		await context.setOffline(false);
		const session = await context.newCDPSession(page);
		const active = Promise.withResolvers();
		const stopped = Promise.withResolvers();
		const wakes = [];
		let versionId;
		let runningStatus;
		session.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
			for (const version of versions) {
				if (
					version.scriptURL === `${site.origin}/recipes/service-worker.js` &&
					version.status === "activated"
				) {
					versionId = version.versionId;
					active.resolve();
				}
				if (version.versionId !== versionId) continue;
				runningStatus = version.runningStatus;
				if (version.runningStatus === "stopped") stopped.resolve();
				else wakes.push(version.runningStatus);
			}
		});
		await session.send("ServiceWorker.enable");
		await active.promise;
		await session.send("ServiceWorker.stopAllWorkers");
		await stopped.promise;
		wakes.length = 0;
		const online = await browse();
		assert.equal(online.status, 200);
		assert.equal(online.body.release, "a".repeat(40));
		assert.equal(runningStatus, "stopped");
		assert.deepEqual(wakes, [], "online browsing does not restart worker A");
		await serve("B");
		assert.deepEqual(await browse(), {
			status: 409,
			body: {
				error: "Recipes have updated. Reload the collection to continue.",
				release: "b".repeat(40),
			},
		});
		assert.equal(runningStatus, "stopped");
		assert.deepEqual(
			wakes,
			[],
			"a stale client reaches the live B API directly",
		);
		await session.detach();
	} finally {
		await context.close();
	}
});

it("Recipe workers still install when static routing is unavailable", {
	timeout: 30_000,
}, async () => {
	const directory = await mkdtemp(join(tmpdir(), "recipe-no-static-routing-"));
	let local;
	let context;
	try {
		await cp(snapshots.A.directory, directory, { recursive: true });
		await writeFile(
			join(directory, "recipes/service-worker.js"),
			`Object.defineProperty(InstallEvent.prototype, "addRoutes", { value: undefined });
self.addEventListener("message", event => {
	if (event.data?.type === "TEST_STATIC_ROUTING")
		event.ports[0].postMessage(typeof InstallEvent.prototype.addRoutes);
});
${snapshots.A.worker}`,
		);
		local = await serveStatic(directory);
		context = await browser.newContext();
		const page = await context.newPage();
		const errors = collectErrors(page);
		await navigateHydrated(page, `${local.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		assert.equal(
			await page.evaluate(
				() =>
					new Promise((resolve) => {
						const channel = new MessageChannel();
						channel.port1.onmessage = ({ data }) => {
							channel.port1.close();
							resolve(data);
						};
						navigator.serviceWorker.controller.postMessage(
							{ type: "TEST_STATIC_ROUTING" },
							[channel.port2],
						);
					}),
			),
			"undefined",
		);
		assert.deepEqual(
			await page.evaluate(async () => {
				const response = await fetch(
					`/api/recipe-browse/?path=%2Frecipes%2Fmeals%2F&browse=1&release=${"a".repeat(40)}`,
					{ headers: { Accept: "application/json" } },
				);
				return {
					status: response.status,
					release: (await response.json()).release,
				};
			}),
			{ status: 200, release: "a".repeat(40) },
		);
		await context.setOffline(true);
		assert.equal(await dataLabel(page), "A");
		assert.deepEqual(errors, []);
	} finally {
		await context?.close();
		await local?.close();
		await rm(directory, { recursive: true, force: true });
	}
});

function updateCheck(name, viewport) {
	it(`Update and reload activates new recipes with another tab open on ${name}`, {
		timeout: 90_000,
	}, async () => {
		await serve("A");
		const context = await browser.newContext({ viewport });
		try {
			const page = await context.newPage();
			const other = await context.newPage();
			await page.clock.install();
			const errors = collectErrors(page, { warnings: true });
			const otherErrors = collectErrors(other, { warnings: true });
			const conflicts = new Map([
				[page, []],
				[other, []],
			]);
			for (const tab of [page, other])
				tab.on("response", (response) => {
					if (
						response.status() === 409 ||
						(response.status() === 404 &&
							new URL(response.url()).pathname ===
								`/recipes/data/summaries/library-${"a".repeat(40)}.json`)
					)
						conflicts
							.get(tab)
							.push({ url: response.url(), status: response.status() });
				});
			await navigateHydrated(
				page,
				`${site.origin}${LANDING}?cooking=1#meal-results`,
			);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
			await page.evaluate(() => {
				window.firstInstallSentinel = true;
			});
			await navigateHydrated(other, `${site.origin}${LANDING}`);
			await statusText(other, SAVED);
			await other.waitForFunction(() => navigator.serviceWorker.controller);
			await other.evaluate(() => {
				window.cookingSentinel = true;
			});
			await page.bringToFront();
			await serve("B");
			await page.clock.fastForward(60_000);
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await page
				.getByRole("status")
				.filter({ hasText: "Update available." })
				.waitFor();
			const button = page.locator("#recipe-update-button");
			await button.waitFor({ state: "visible" });
			await page.getByRole("button", { name: "Later", exact: true }).click();
			assert.equal(await button.isVisible(), false);
			await page
				.getByRole("button", { name: "Show update", exact: true })
				.click();
			assert.equal(await button.isVisible(), true);
			assert.equal(
				await snapshotLabel(page),
				"A",
				"download alone never reloads",
			);
			assert.equal(
				await page.evaluate(() => window.firstInstallSentinel),
				true,
			);
			assert.equal(
				await page.locator("#site-update-notice").isVisible(),
				false,
			);
			for (const colorScheme of ["light", "dark"]) {
				// biome-ignore lint/performance/noAwaitInLoops: Check both themes in the same tab.
				await page.emulateMedia({ colorScheme });
				await assertUpdateNoticeLayout(page.locator(".recipe-pwa"));
				if (process.env.UI_EVIDENCE_DIR) {
					await button.scrollIntoViewIfNeeded();
					await page.screenshot({
						animations: "disabled",
						path: join(
							process.env.UI_EVIDENCE_DIR,
							`recipe-update-${name}-${colorScheme}.png`,
						),
					});
				}
			}
			// The downloaded update can activate offline, without closing either tab.
			await context.setOffline(true);
			await Promise.all(
				[page, other].map((tab) =>
					tab.waitForFunction(
						() =>
							!navigator.onLine &&
							document.querySelector(".results-heading h2")?.textContent ===
								"Saved recipes",
					),
				),
			);
			await page.evaluate(() => {
				window.activationEvents = [];
				for (const type of ["click", "keydown"])
					document.addEventListener(
						type,
						(event) =>
							window.activationEvents.push({
								type,
								key: event.key,
								target: event.target.id,
							}),
						true,
					);
			});
			if (name === "desktop") {
				await button.focus();
				await button.press("Enter");
			} else await button.click();
			try {
				await page.waitForFunction(
					() =>
						document.querySelector('meta[name="pwa-test-snapshot"]')
							?.content === "B",
				);
			} catch (error) {
				error.message += `\nActivation diagnostics: ${JSON.stringify(
					await page.evaluate(async () => {
						const registration =
							await navigator.serviceWorker.getRegistration();
						return {
							events: window.activationEvents,
							status: document.querySelector("#recipe-offline-status")
								?.textContent,
							disabled: document.querySelector("#recipe-update-button")
								?.disabled,
							focus: {
								tag: document.activeElement?.tagName,
								id: document.activeElement?.id,
							},
							waiting: registration?.waiting?.state,
							active: registration?.active?.state,
							controller: navigator.serviceWorker.controller?.state,
							dirty: [...document.querySelectorAll("form input, form textarea")]
								.filter((input) => input.value !== input.defaultValue)
								.map((input) => ({
									name: input.name,
									type: input.type,
									value: input.value,
									initial: input.defaultValue,
								})),
						};
					}),
				)}`;
				throw error;
			}
			await navigateHydrated(page);
			assert.equal(await dataLabel(page), "B");
			assert.equal(new URL(page.url()).search, "?cooking=1");
			assert.equal(new URL(page.url()).hash, "#meal-results");
			await other
				.getByRole("status")
				.filter({ hasText: "Recipes were updated in another tab." })
				.waitFor();
			assert.equal(
				await snapshotLabel(other),
				"A",
				"other tab does not reload automatically",
			);
			assert.equal(await other.evaluate(() => window.cookingSentinel), true);
			await other.getByRole("combobox", { name: SERVINGS }).selectOption("2");
			// Suspension must not lose retained-cache ownership. A-only code is
			// first requested by the old document after the new worker restarts.
			await stopRecipeWorkers(context);
			await other
				.getByRole("button", { name: "Load saved cooking tool", exact: true })
				.click();
			await other
				.getByRole("button", { name: "Cooking tool A", exact: true })
				.waitFor();
			assert.equal(
				await other.getByRole("combobox", { name: SERVINGS }).inputValue(),
				"2",
			);
			await other.locator("#recipe-update-button").click();
			await other.waitForFunction(
				() =>
					document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
					"B",
			);
			await statusText(other, OFFLINE);
			assert.equal(
				await other.locator("#recipe-update-action").isVisible(),
				false,
				"no update loop",
			);
			await waitForBrowserState(
				other,
				async (cache) => {
					const keys = (await caches.keys()).filter(
						(key) => key !== "recipe-pages-pwa-ownership",
					);
					return keys.includes(cache);
				},
				snapshots.B.cache,
			);
			// A deferred old document request can reach B after the swap. The
			// local fixture has no retained A summary URL, so its precise 404 must
			// offer an update, just as the native API's release conflict does.
			// Every other HTTP diagnostic still fails this scenario.
			for (const value of [...conflicts.values()].flat()) {
				const url = new URL(value.url);
				assert.deepEqual(
					{ path: url.pathname, release: url.searchParams.get("release") },
					value.status === 409
						? { path: "/api/recipe-browse/", release: "a".repeat(40) }
						: {
								path: `/recipes/data/summaries/library-${"a".repeat(40)}.json`,
								release: null,
							},
				);
			}
			const diagnostic = ({ status }) =>
				`Failed to load resource: the server responded with a status of ${status === 409 ? "409 (Conflict)" : "404 (Not Found)"}`;
			assert.deepEqual(errors, conflicts.get(page).map(diagnostic));
			assert.deepEqual(otherErrors, conflicts.get(other).map(diagnostic));
		} finally {
			await context.close();
		}
	});
}

for (const [name, viewport] of VIEWPORTS) updateCheck(name, viewport);

it("A stalled recipe activation restores the button and can be retried", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.clock.install();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await serve("B");
		await page.clock.fastForward(60_000);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		const button = page.locator("#recipe-update-button");
		await button.waitFor({ state: "visible" });
		// Simulate a worker that never handles the activation message, rather
		// than replacing the real registration or its downloaded snapshot.
		await page.evaluate(() => {
			window.workerPostMessage = ServiceWorker.prototype.postMessage;
			ServiceWorker.prototype.postMessage = function (...args) {
				if (args[0]?.type === "ACTIVATE_RECIPE_UPDATE") {
					window.activationWithheld = true;
					return;
				}
				// biome-ignore lint/nursery/noThisOutsideOfClass: preserve the native ServiceWorker receiver while withholding only activation.
				return window.workerPostMessage.apply(this, args);
			};
		});
		await button.click();
		assert.equal(await button.isDisabled(), true);
		await page.waitForFunction(() => window.activationWithheld);
		await page.clock.fastForward(15_000);
		await page
			.getByRole("status")
			.filter({ hasText: "could not be applied" })
			.waitFor();
		assert.equal(await button.isEnabled(), true);
		assert.equal(await snapshotLabel(page), "A");
		await page.evaluate(() => {
			ServiceWorker.prototype.postMessage = window.workerPostMessage;
		});
		await button.click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		assert.equal(await dataLabel(page), "B");
	} finally {
		await context.close();
	}
});

function cookingGuardCheck(name, viewport) {
	it(`Recipe update confirms real unsaved cooking checks and preserves cancellation on ${name}`, {
		timeout: 90_000,
	}, async () => {
		await serve("A");
		const context = await browser.newContext({ viewport });
		try {
			const page = await context.newPage();
			await page.clock.install();
			await navigateHydrated(
				page,
				`${site.origin}/recipes/lemon-salmon-and-asparagus/`,
			);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
			await setLegacyUnits(page, "grams");
			const ingredient = page
				.locator(
					".trn-ingredient [role=checkbox]:visible, .mobile-ingredient [role=checkbox]:visible",
				)
				.first();
			await ingredient.click();
			assert.equal(await ingredient.getAttribute("aria-checked"), "true");
			await serve("B");
			await page.clock.fastForward(60_000);
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			const update = page.locator("#recipe-update-button");
			await update.waitFor({ state: "visible" });
			const originalRelease = await page
				.locator("#site-update-notice")
				.getAttribute("data-release");
			await update.focus();
			const dismissed = page.waitForEvent("dialog");
			const click = update.press("Enter");
			const dialog = await dismissed;
			assert.equal(
				dialog.type(),
				"confirm",
				"known unsaved checks require explicit confirmation",
			);
			assert.match(dialog.message(), UNSAVED_CONFIRMATION);
			await dialog.dismiss();
			await click;
			assert.equal(
				await ingredient.getAttribute("aria-checked"),
				"true",
				"cancel preserves cooking work",
			);
			assert.equal(
				await page.locator("#site-update-notice").getAttribute("data-release"),
				originalRelease,
			);
			assert.equal(
				await update.evaluate((node) => node === document.activeElement),
				true,
				"cancel preserves keyboard focus",
			);
			let reloads = 0;
			page.on("framenavigated", (frame) => {
				if (frame === page.mainFrame()) reloads += 1;
			});
			const accepted = page.waitForEvent("dialog");
			const apply = update.press("Enter");
			await (await accepted).accept();
			await apply;
			await page.waitForFunction(
				(sha) =>
					document.querySelector("#site-update-notice").dataset.release === sha,
				"b".repeat(40),
			);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			assert.equal(reloads, 1, "accepted activation reloads exactly once");
			assert.equal(
				await legacyUnits(page),
				"grams",
				"saved preferences survive confirmed reload",
			);
			assert.equal(
				await page
					.locator(".trn-ingredient.checked, .mobile-ingredient.checked")
					.count(),
				0,
			);
		} finally {
			await context.close();
		}
	});
}

for (const [name, viewport] of VIEWPORTS) cookingGuardCheck(name, viewport);

it("Recipe Later is release-specific and distinct waiting C restores the update action", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		const update = page.locator("#recipe-update-button");
		await update.waitFor({ state: "visible" });
		await page.getByRole("button", { name: "Later", exact: true }).click();
		assert.equal(await update.isVisible(), false);
		assert.equal(
			await page
				.locator("#recipe-update-show")
				.evaluate((node) => node === document.activeElement),
			true,
		);
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		assert.equal(
			await update.isVisible(),
			false,
			"same waiting release stays dismissed",
		);
		await serve("C");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await update.waitFor({ state: "visible" });
		assert.equal(
			await snapshotLabel(page),
			"A",
			"distinct release announcement does not reload",
		);
		await update.click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"C",
		);
		assert.equal(await dataLabel(page), "C");
	} finally {
		await context.close();
	}
});

it("The last deployed worker/cache layout upgrades with live A clients and preserves their offline resources", {
	timeout: 90_000,
}, async () => {
	await serve("legacy");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		const other = await context.newPage();
		for (const tab of [page, other]) {
			// biome-ignore lint/performance/noAwaitInLoops: establish both old controlled clients before publishing B.
			await navigateHydrated(tab, `${site.origin}${LANDING}`);
			await tab.waitForFunction(() => navigator.serviceWorker.controller);
		}
		assert.ok(
			(await page.evaluate(() => caches.keys())).includes(
				snapshots.legacy.cache,
			),
		);
		const legacyRecipe = "/recipes/lemon-salmon-and-asparagus/";
		const oldRecipeBody = await page.evaluate(
			async ({ cache, path }) => {
				const request = new Request(new URL(path, location.origin), {
					headers: { accept: "text/html" },
				});
				const response = await fetch(request);
				const body = await response.clone().text();
				await (await caches.open(cache)).put(request, response);
				return body;
			},
			{ cache: snapshots.legacy.cache, path: legacyRecipe },
		);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		const update = page.locator("#recipe-update-button");
		await update.waitFor({ state: "visible" });
		await update.click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		await other
			.getByRole("status")
			.filter({ hasText: "Recipes were updated in another tab." })
			.waitFor();
		await context.setOffline(true);
		assert.equal(await snapshotLabel(other), "A");
		assert.equal(
			await dataLabel(other),
			"A",
			"legacy mutable data remains consistent with A document",
		);
		await other
			.getByRole("button", { name: "Load saved cooking tool", exact: true })
			.click();
		await other
			.getByRole("button", { name: "Cooking tool A", exact: true })
			.waitFor();
		assert.ok(
			(await other.evaluate(() => caches.keys())).includes(
				snapshots.legacy.cache,
			),
			"legacy cache remains while old client uses it",
		);
		await other.locator("#recipe-update-button").click();
		await other.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		assert.equal(await dataLabel(other), "B");
		const legacyAfter = await other.evaluate(
			async ({ cache, path }) => {
				const request = new Request(new URL(path, location.origin), {
					headers: { accept: "text/html" },
				});
				const response = await (await caches.open(cache)).match(request);
				const channel = new MessageChannel();
				const listed = new Promise((resolve) => {
					channel.port1.onmessage = ({ data }) => {
						channel.port1.close();
						resolve(data.recipes);
					};
				});
				navigator.serviceWorker.controller.postMessage(
					{ type: "LIST_SAVED_RECIPES" },
					[channel.port2],
				);
				return { body: await response.text(), saved: await listed };
			},
			{ cache: snapshots.legacy.cache, path: legacyRecipe },
		);
		assert.equal(
			legacyAfter.body,
			oldRecipeBody,
			"legacy recipe bytes remain read-only after migration",
		);
		assert.deepEqual(
			legacyAfter.saved,
			[],
			"legacy complete-cache entries never become implicit saved recipes",
		);
	} finally {
		await context.close();
	}
});

it("A and B clients retain their own offline data and lazy assets under active C after worker restart", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const a = await context.newPage();
		const b = await context.newPage();
		const current = await context.newPage();
		for (const page of [a, b, current]) {
			// biome-ignore lint/performance/noAwaitInLoops: establish A clients before each deployment transition.
			await navigateHydrated(page, `${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
		}
		await serve("B");
		await b.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await b.locator("#recipe-update-button").waitFor({ state: "visible" });
		await b.locator("#recipe-update-button").click();
		await b.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		await current
			.locator("#recipe-update-button")
			.waitFor({ state: "visible" });
		await current.locator("#recipe-update-button").click();
		await current.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		await serve("C");
		await current.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await current
			.locator("#recipe-update-button")
			.waitFor({ state: "visible" });
		await current.locator("#recipe-update-button").click();
		await current.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"C",
		);
		await context.setOffline(true);
		await stopRecipeWorkers(context);
		for (const [page, label] of [
			[a, "A"],
			[b, "B"],
		]) {
			// biome-ignore lint/performance/noAwaitInLoops: validate each live historical document against its own release.
			assert.equal(await snapshotLabel(page), label);
			assert.equal(await dataLabel(page), label);
			await page
				.getByRole("button", { name: "Load saved cooking tool", exact: true })
				.click();
			await page
				.getByRole("button", { name: `Cooking tool ${label}`, exact: true })
				.waitFor();
		}
		assert.ok(
			(await current.evaluate(() => caches.keys())).includes(snapshots.A.cache),
		);
		assert.ok(
			(await current.evaluate(() => caches.keys())).includes(snapshots.B.cache),
		);
		await a.close();
		await b.locator("#recipe-update-button").click();
		await b.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"C",
		);
		await waitForBrowserState(
			b,
			async (cache) => {
				const keys = (await caches.keys()).filter(
					(key) => key !== "recipe-pages-pwa-ownership",
				);
				return keys.includes(cache);
			},
			snapshots.C.cache,
		);
		assert.equal(await dataLabel(b), "C");
	} finally {
		await context.close();
	}
});

it("A failed worker version handshake preserves the confirmed target for explicit retry", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.clock.install();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		const update = page.locator("#recipe-update-button");
		await update.waitFor({ state: "visible" });
		const activating = await context.newPage();
		await navigateHydrated(activating, `${site.origin}${LANDING}`);
		await activating
			.locator("#recipe-update-button")
			.waitFor({ state: "visible" });
		await activating.locator("#recipe-update-button").click();
		await activating.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		await page
			.getByRole("status")
			.filter({ hasText: "Recipes were updated in another tab." })
			.waitFor();
		await page.evaluate(() => {
			window.savedWorkerPost = ServiceWorker.prototype.postMessage;
			ServiceWorker.prototype.postMessage = function (...args) {
				if (args[0]?.type === "RECIPE_VERSION") {
					window.versionDropped = true;
					return;
				}
				// biome-ignore lint/nursery/noThisOutsideOfClass: forward native calls with their original receiver.
				return window.savedWorkerPost.apply(this, args);
			};
		});
		await page.clock.fastForward(60_000);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await page.waitForFunction(() => window.versionDropped);
		await page.clock.fastForward(15_001);
		await page
			.getByRole("status")
			.filter({ hasText: "Could not verify the recipe update" })
			.waitFor();
		assert.equal(await snapshotLabel(page), "A");
		assert.equal(await update.isEnabled(), true);
		await page.evaluate(() => {
			ServiceWorker.prototype.postMessage = window.savedWorkerPost;
		});
		await page.clock.fastForward(35 * 60_000);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await page
			.getByRole("status")
			.filter({ hasText: "Recipes were updated in another tab." })
			.waitFor();
		assert.equal(
			await update.isEnabled(),
			true,
			"successful re-verification clears the earlier failure for the same B target",
		);
		await update.click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
	} finally {
		await context.close();
	}
});

it("An older failed identity check cannot overwrite a newer confirmed worker update", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.clock.install();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await page.evaluate(() => {
			window.raceWorkerPost = ServiceWorker.prototype.postMessage;
			ServiceWorker.prototype.postMessage = function (...args) {
				if (args[0]?.type === "RECIPE_VERSION" && !window.heldVersionPort) {
					window.heldVersionPort = args[1][0];
					return;
				}
				// biome-ignore lint/nursery/noThisOutsideOfClass: preserve the native worker receiver for subsequent newer checks.
				return window.raceWorkerPost.apply(this, args);
			};
		});
		await page.clock.fastForward(60_000);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await page.waitForFunction(() => window.heldVersionPort);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		const update = page.locator("#recipe-update-button");
		await update.waitFor({ state: "visible" });
		await page.evaluate(() => {
			window.heldVersionPort.postMessage({ release: "invalid" });
		});
		await page.clock.fastForward(5_001);
		assert.equal(await update.isEnabled(), true);
		assert.ok(
			(await page.locator("#recipe-offline-status").textContent()).includes(
				"Update available",
			),
		);
		await page.evaluate(() => {
			ServiceWorker.prototype.postMessage = window.raceWorkerPost;
		});
		await update.click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
	} finally {
		await context.close();
	}
});

it("Fresh B HTML under A control still offers explicit activation of waiting B without first-install reload", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const old = await context.newPage();
		await navigateHydrated(old, `${site.origin}${LANDING}`);
		await statusText(old, SAVED);
		await old.waitForFunction(() => navigator.serviceWorker.controller);
		await serve("B");
		await old.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await old.locator("#recipe-update-button").waitFor({ state: "visible" });
		const fresh = await context.newPage();
		await navigateHydrated(fresh, `${site.origin}/recipes/new-release/`);
		assert.equal(await snapshotLabel(fresh), "B");
		await fresh.waitForFunction(() => navigator.serviceWorker.controller);
		await fresh.locator("#recipe-update-button").waitFor({ state: "visible" });
		let reloads = 0;
		fresh.on("framenavigated", (frame) => {
			if (frame === fresh.mainFrame()) reloads += 1;
		});
		await Promise.all([
			fresh.waitForEvent("load"),
			fresh.locator("#recipe-update-button").click(),
		]);
		await fresh.waitForFunction(
			() => document.querySelector("#recipe-update-action")?.hidden === true,
		);
		assert.equal(reloads, 1);
		assert.equal(await snapshotLabel(fresh), "B");
		assert.equal(
			await snapshotLabel(old),
			"A",
			"activation never reloads the old tab",
		);
	} finally {
		await context.close();
	}
});

it("Reloading A offline rediscovers downloaded waiting B and applies it with another tab open", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		const other = await context.newPage();
		for (const tab of [page, other]) {
			// biome-ignore lint/performance/noAwaitInLoops: install A before creating the waiting B snapshot.
			await navigateHydrated(tab, `${site.origin}${LANDING}`);
			await statusText(tab, SAVED);
			await tab.waitForFunction(() => navigator.serviceWorker.controller);
		}
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await context.setOffline(true);
		await navigateHydrated(page);
		assert.equal(await snapshotLabel(page), "A");
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await page.locator("#recipe-update-button").click();
		await page.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		assert.equal(await dataLabel(page), "B");
		assert.equal(await snapshotLabel(other), "A");
	} finally {
		await context.close();
	}
});
