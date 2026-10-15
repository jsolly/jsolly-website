import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { collectErrors, readBuilt } from "./pages.mjs";
import {
	BLOG_CHROME,
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
	SMOOTHIES,
	serve,
	site,
	snapshotLabel,
	snapshots,
	statuses,
	statusText,
	VIEWPORTS,
	WORKER,
	waitForBrowserState,
} from "./recipes-pwa-fixture.mjs";

function installCheck(name, viewport) {
	it(`Recipe PWA installs and cooking tools work offline on ${name}`, {
		timeout: 90_000,
	}, async () => {
		await serve("A");
		const { urls } = snapshots.A;
		for (const label of ["A", "B"]) {
			const { worker, rebuilt } = snapshots[label];
			assert.equal(
				rebuilt,
				worker,
				`${label}: a rebuild writes the same worker`,
			);
		}
		assert.deepEqual(urls, [...urls].sort(), "the precache list is sorted");
		// The snapshot: every recipe page, the two assistant downloads and the
		// files the pages load, and no page outside /recipes/.
		for (const page of RECIPE_PAGES) {
			assert.ok(urls.includes(page), `the snapshot holds ${page}`);
		}
		assert.deepEqual(
			urls.filter((url) => url.startsWith("/recipes/data/")),
			DATA_FILES,
		);
		assert.deepEqual(
			urls.filter(
				(url) =>
					!(
						url.startsWith("/recipes/") ||
						url.startsWith("/_astro/") ||
						url === "/favicon.ico" ||
						url === "/recipes.md" ||
						BLOG_CHROME.test(url)
					),
			),
			[],
			"precached paths outside /recipes/, the build output and the blog chrome",
		);
		assert.equal(urls.includes(WORKER), false, "the worker is not precached");
		// The no-JavaScript stylesheets every recipe page loads inside <noscript>
		// work offline too.
		const fallbackStyles = new Set(
			(
				await Promise.all(
					RECIPE_PAGES.map((path) =>
						readBuilt(path, (document) =>
							[
								...document.querySelectorAll("noscript link[rel=stylesheet]"),
							].map((link) => link.getAttribute("href")),
						),
					),
				)
			).flat(),
		);
		assert.ok(fallbackStyles.size > 0, "recipe pages have noscript styles");
		for (const href of fallbackStyles) {
			assert.ok(
				urls.includes(href),
				`Offline snapshot includes no-JavaScript stylesheet ${href}`,
			);
		}

		const context = await browser.newContext({ viewport });
		const page = await context.newPage();
		const errors = collectErrors(page, { warnings: true });
		try {
			await page.addInitScript(() => {
				sessionStorage.setItem(
					"pwaNavigations",
					String(Number(sessionStorage.getItem("pwaNavigations") ?? 0) + 1),
				);
			});
			await navigateHydrated(page, `${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			assert.equal(await page.locator(".recipe-pwa").isVisible(), false);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
			assert.equal(
				await page.evaluate(() => sessionStorage.getItem("pwaNavigations")),
				"1",
				"first install never reloads",
			);
			const metadata = await page.evaluate(async (selector) => {
				const link = document.querySelector(selector);
				const manifest = await fetch(link.href).then((response) =>
					response.json(),
				);
				const { scope, active } =
					await navigator.serviceWorker.getRegistration();
				return { manifest, scope, script: active.scriptURL };
			}, MANIFEST_LINK);
			assert.equal(metadata.manifest.id, SCOPE);
			assert.equal(metadata.manifest.start_url, SCOPE);
			assert.equal(metadata.manifest.scope, SCOPE);
			assert.equal(metadata.manifest.display, "standalone");
			assert.equal(metadata.scope, `${site.origin}${SCOPE}`);
			assert.equal(metadata.script, `${site.origin}${WORKER}`);
			assert.deepEqual(
				await statuses(
					page,
					metadata.manifest.icons.map(({ src }) => src),
				),
				[200, 200],
				"the manifest icons",
			);

			await page
				.getByRole("combobox", { name: "Ingredient units" })
				.selectOption("grams");
			await context.setOffline(true);
			await navigateHydrated(page);
			assert.equal(
				await page
					.getByRole("combobox", { name: "Ingredient units" })
					.inputValue(),
				"grams",
			);
			await statusText(page, OFFLINE);
			await page.locator(".recipe-pwa").waitFor({ state: "visible" });
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
			await page
				.locator(".recipe-card")
				.filter({ hasText: "Lemon salmon and asparagus" })
				.getByRole("link", { name: "Open recipe: Lemon salmon and asparagus" })
				.click();
			await page.locator(".recipe-detail .reset-checks:visible").waitFor();
			assert.ok((await page.locator(".recipe-detail .trn-table").count()) > 0);
			await page.waitForFunction(() =>
				[...document.querySelectorAll(".recipe-detail img")].every(
					(image) => image.complete && image.naturalWidth > 0,
				),
			);
			assert.deepEqual(
				await statuses(page, DATA_FILES),
				[200, 200],
				"the assistant downloads offline",
			);
			// Changing the recipe URL's query or fragment still opens the cached app.
			await navigateHydrated(
				page,
				`${site.origin}${LANDING}?cooking=1#meal-results`,
			);
			const servings = page.getByRole("combobox", { name: SERVINGS });
			await servings.waitFor();
			assert.equal(await servings.inputValue(), "2");
			// A shared recipe link opens offline with its settings, and its
			// notation dialog still opens.
			await navigateHydrated(page, `${site.origin}${SHARED_RECIPE}`);
			await page.locator(".recipe-detail .reset-checks:visible").waitFor();
			assert.equal(
				await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
				"8",
			);
			await page.getByRole("button", { name: LEARN_MORE, exact: true }).click();
			await page.locator(".method-dialog").waitFor();
			await page
				.getByRole("button", { name: "Close and continue recipe" })
				.click();
			await page
				.getByRole("combobox", { name: "Ingredient units" })
				.selectOption("metric");
			// So does a collection page.
			await navigateHydrated(page, `${site.origin}/recipes/smoothies/`);
			await page.locator("[data-hydrated=true]").waitFor();
			assert.equal(await page.locator(".recipe-card").count(), SMOOTHIES);
			assert.equal(
				await page
					.getByRole("combobox", { name: "Ingredient units" })
					.inputValue(),
				"metric",
			);
			assert.deepEqual(errors, []);
			// The worker answers for its snapshot only: a blog page is not in it.
			// (The failed request logs a console error, so this comes last.)
			assert.equal(
				await page.evaluate(() =>
					fetch("/blog/").then(
						() => "answered",
						() => "failed",
					),
				),
				"failed",
				"/blog/ offline from a recipe page",
			);

			await context.setOffline(false);
			await page.locator(".recipe-pwa").waitFor({ state: "hidden" });
			for (const path of ["/blog/", "/about/"]) {
				// biome-ignore lint/performance/noAwaitInLoops: one page at a time in the one tab
				await navigateHydrated(page, `${site.origin}${path}`);
				assert.equal(await controlled(page), false, `${path} is controlled`);
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
		await page
			.getByText("Net carbs per serving", { exact: true })
			.first()
			.waitFor();
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
		await tabs[0]
			.locator("#recipe-offline-status")
			.filter({ hasText: "Updated recipes are downloaded" })
			.waitFor({ state: "visible" });
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
					keys.length === 1 &&
					keys[0] === cache
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
			[snapshots.B.cache],
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
		await context.setOffline(true);
		const results = await page.evaluate(() => {
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
					["/recipes/data/recipe-library.md", "application/json", "GET"],
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
		});
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
		assert.ok(results[1].body.includes("Easy Meals"));
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
			"assistant data is static even for a rejected page Accept",
		);
		assert.equal(
			results[7].body,
			await readFile(
				join(snapshots.A.directory, "recipes/data/recipe-library.md"),
				"utf8",
			),
			"static assistant download retains its exact built body",
		);
	} finally {
		await context.close();
	}
});
