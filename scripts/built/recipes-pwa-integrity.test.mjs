import assert from "node:assert/strict";
import { it } from "node:test";
import {
	browser,
	dataLabel,
	LANDING,
	navigateHydrated,
	SAVED,
	serve,
	site,
	snapshotLabel,
	snapshots,
	statusText,
	waitForBrowserState,
} from "./recipes-pwa-fixture.mjs";

it("A complete HTTP200 mixed deployment fails installation, preserves A offline and retries repaired B", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await serve("mixed");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await statusText(page, "Update download failed.");
		assert.equal(
			await page.locator("#recipe-update-button").isVisible(),
			false,
			"HTTP200 mismatched bytes never claim ready",
		);
		assert.equal(await snapshotLabel(page), "A");
		await context.setOffline(true);
		await navigateHydrated(page);
		assert.equal(await snapshotLabel(page), "A");
		assert.equal(await dataLabel(page), "A");
		await context.setOffline(false);
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await page.locator("#recipe-update-button").click();
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

it("Rollback reuses validated live A cache without overwriting it with mismatched HTTP200 network data", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const old = await context.newPage();
		const moving = await context.newPage();
		for (const page of [old, moving]) {
			// biome-ignore lint/performance/noAwaitInLoops: both A clients exist before activating B and retaining A.
			await navigateHydrated(page, `${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
		}
		await serve("B");
		await moving.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await moving.locator("#recipe-update-button").waitFor({ state: "visible" });
		await moving.locator("#recipe-update-button").click();
		await moving.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		assert.equal(await dataLabel(old), "A");
		assert.ok(
			(await old.evaluate(() => caches.keys())).includes(snapshots.A.cache),
		);
		await serve("rollback");
		await moving.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await moving.locator("#recipe-update-button").waitFor({ state: "visible" });
		assert.equal(
			await dataLabel(old),
			"A",
			"rollback installation cannot overwrite a live historical cache",
		);
		await moving.locator("#recipe-update-button").click();
		await moving.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"A",
		);
		assert.equal(await dataLabel(moving), "A");
		assert.equal(await dataLabel(old), "A");
		await context.setOffline(true);
		await navigateHydrated(moving);
		assert.equal(await snapshotLabel(moving), "A");
		assert.equal(await dataLabel(moving), "A");
		await context.setOffline(false);
		await serve("C");
		await moving.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await moving.locator("#recipe-update-button").waitFor({ state: "visible" });
		await moving.locator("#recipe-update-button").click();
		await moving.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"C",
		);
		await old
			.getByRole("status")
			.filter({ hasText: "Recipes were updated in another tab." })
			.waitFor();
		await context.setOffline(true);
		assert.equal(await snapshotLabel(old), "A");
		assert.equal(
			await dataLabel(old),
			"A",
			"C activation retains the actual active rollback A rather than newer-created historical B",
		);
		await old
			.getByRole("button", { name: "Load saved cooking tool", exact: true })
			.click();
		await old
			.getByRole("button", { name: "Cooking tool A", exact: true })
			.waitFor();
		await old.locator("#recipe-update-button").click();
		await old.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"C",
		);
		assert.equal(await dataLabel(old), "C");
	} finally {
		await context.close();
	}
});

it("A waiting rollback snapshot survives retirement of its last historical client and applies offline", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const old = await context.newPage();
		const moving = await context.newPage();
		for (const page of [old, moving]) {
			// biome-ignore lint/performance/noAwaitInLoops: establish both owners before activating B.
			await navigateHydrated(page, `${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
		}
		await serve("B");
		await moving.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await moving.locator("#recipe-update-button").waitFor({ state: "visible" });
		await moving.locator("#recipe-update-button").click();
		await moving.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"B",
		);
		await serve("A");
		await moving.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await moving.locator("#recipe-update-button").waitFor({ state: "visible" });
		const ownership = await moving.evaluate(async () =>
			(
				await (
					await caches.open("recipe-pages-pwa-ownership")
				).match("/recipes/__snapshot_owners__")
			).json(),
		);
		assert.equal(ownership.active, snapshots.B.cache);
		assert.equal(ownership.pending.cache, snapshots.A.cache);
		await old.close();
		// A readiness handshake forces active B's retirement sweep after A's
		// final document closes. Waiting A must retain independent ownership.
		await moving.evaluate(
			(release) =>
				navigator.serviceWorker.controller.postMessage({
					type: "RECIPE_CLIENT_READY",
					release,
				}),
			"b".repeat(40),
		);
		await waitForBrowserState(
			moving,
			async ({ active, pending }) => {
				const clientRecord = await (await caches.open(active)).match(
					"/recipes/__previous_snapshot_clients__",
				);
				const retained = clientRecord
					? await clientRecord.json()
					: { clients: {} };
				if (Object.values(retained.clients).includes(pending)) return false;
				const ownerStore = await caches.open("recipe-pages-pwa-ownership");
				const owners = await (
					await ownerStore.match("/recipes/__snapshot_owners__")
				).json();
				return (
					owners.active &&
					owners.pending &&
					(await caches.keys()).includes(owners.pending.cache)
				);
			},
			{ active: snapshots.B.cache, pending: snapshots.A.cache },
		);
		const complete = await moving.evaluate(
			async ({ cache, paths }) => {
				const store = await caches.open(cache);
				const results = await Promise.all(
					paths.map((path) =>
						store.match(
							new Request(new URL(path, location.origin), {
								headers: {
									accept: path.endsWith("/")
										? "text/html"
										: path.endsWith(".md")
											? "text/markdown"
											: "*/*",
								},
							}),
						),
					),
				);
				return (
					results.every(Boolean) &&
					Boolean(await store.match("/recipes/__snapshot_identity__"))
				);
			},
			{ cache: snapshots.A.cache, paths: snapshots.A.urls },
		);
		assert.equal(
			complete,
			true,
			"waiting A keeps every verified asset and identity marker",
		);
		await context.setOffline(true);
		await moving.locator("#recipe-update-button").click();
		await moving.waitForFunction(
			() =>
				document.querySelector('meta[name="pwa-test-snapshot"]')?.content ===
				"A",
		);
		assert.equal(await dataLabel(moving), "A");
		await moving
			.getByRole("button", { name: "Load saved cooking tool", exact: true })
			.click();
		await moving
			.getByRole("button", { name: "Cooking tool A", exact: true })
			.waitFor();
	} finally {
		await context.close();
	}
});

it("An oversized HTTP200 candidate cannot claim readiness and repaired B remains retryable", {
	timeout: 90_000,
}, async () => {
	await serve("A");
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await navigateHydrated(page, `${site.origin}${LANDING}`);
		await statusText(page, SAVED);
		await page.waitForFunction(() => navigator.serviceWorker.controller);
		await serve("oversized");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await statusText(page, "Update download failed.");
		assert.equal(
			await page.locator("#recipe-update-button").isVisible(),
			false,
		);
		assert.equal(await dataLabel(page), "A");
		await serve("B");
		await page.evaluate(async () =>
			(await navigator.serviceWorker.getRegistration()).update(),
		);
		await page.locator("#recipe-update-button").waitFor({ state: "visible" });
		await page.locator("#recipe-update-button").click();
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
