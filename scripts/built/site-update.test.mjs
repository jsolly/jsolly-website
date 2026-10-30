import assert from "node:assert/strict";
import {
	cp,
	mkdtemp,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic, stubOffOrigin } from "./pages.mjs";
import { assertUpdateNoticeLayout } from "./update-notice-layout.mjs";

const ROUTES = ["/", "/blog/", "/recipes/"];
const NEXT_SHA = "b".repeat(40);
const THIRD_SHA = "c".repeat(40);
let fixture;
let served;
let site;
let browser;

async function serve(label) {
	await symlink(join(fixture, label), `${served}.next`, "dir");
	await rename(`${served}.next`, served);
}

// A replacement deployment has release-named browse artifacts as well as HTML.
async function retargetBrowseArtifacts(label, originalSha, sha) {
	await Promise.all(
		[
			["summaries", "library"],
			["search", "index"],
		].map(async ([directory, prefix]) => {
			const folder = join(fixture, label, "recipes/data", directory);
			const artifact = JSON.parse(
				await readFile(join(folder, `${prefix}-${originalSha}.json`), "utf8"),
			);
			if (artifact.release !== originalSha)
				throw new Error("Browse fixture has an unexpected release");
			artifact.release = sha;
			await writeFile(
				join(folder, `${prefix}-${sha}.json`),
				JSON.stringify(artifact),
			);
		}),
	);
}

before(async () => {
	fixture = await mkdtemp(join(tmpdir(), "site-update-test-"));
	served = join(fixture, "served");
	await cp("dist", join(fixture, "A"), { recursive: true });
	await cp("dist", join(fixture, "B"), { recursive: true });
	const originalSha = JSON.parse(
		await readFile(join(fixture, "A", "release.json"), "utf8"),
	).sha;
	await Promise.all(
		ROUTES.map(async (route) => {
			const file = join(fixture, "B", route, "index.html");
			// The new deployment has a distinct page-embedded identity as well as
			// its release endpoint. It must not offer the same update after reload.
			await writeFile(
				file,
				(await readFile(file, "utf8")).replaceAll(originalSha, NEXT_SHA),
			);
		}),
	);
	await writeFile(
		join(fixture, "B", "release.json"),
		JSON.stringify({ sha: NEXT_SHA }),
	);
	await retargetBrowseArtifacts("B", originalSha, NEXT_SHA);
	await cp(join(fixture, "B"), join(fixture, "C"), { recursive: true });
	await Promise.all(
		ROUTES.map(async (route) => {
			const file = join(fixture, "C", route, "index.html");
			await writeFile(
				file,
				(await readFile(file, "utf8")).replaceAll(NEXT_SHA, THIRD_SHA),
			);
		}),
	);
	await writeFile(
		join(fixture, "C", "release.json"),
		JSON.stringify({ sha: THIRD_SHA }),
	);
	await retargetBrowseArtifacts("C", originalSha, THIRD_SHA);
	await serve("A");
	site = await serveStatic(served, { "Cache-Control": "no-store" });
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
	if (fixture) await rm(fixture, { recursive: true, force: true });
});

function updateCheck(route) {
	it(`Website update notice reloads ${route} into the new release only on request`, async () => {
		await serve("A");
		const context = await browser.newContext({ serviceWorkers: "block" });
		try {
			await stubOffOrigin(context, site.origin);
			const page = await context.newPage();
			const errors = collectErrors(page);
			const conflicts = [];
			page.on("response", (response) => {
				if (response.status() === 409) conflicts.push(response.url());
			});
			await page.clock.install();
			await page.goto(`${site.origin}${route}`);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			const notice = page.locator("#site-update-notice");
			const original = await notice.getAttribute("data-release");
			assert.notEqual(original, NEXT_SHA);
			assert.equal(await notice.isVisible(), false, "same release stays quiet");
			// Malformed release identity is not an update, including an HTML
			// fallback, a truncated SHA or a valid JSON object with no SHA.
			for (const body of [
				"<html>Unavailable</html>",
				'{"sha":"abc"}',
				"{}",
				"null",
			]) {
				// biome-ignore lint/performance/noAwaitInLoops: exercise each response sequentially in the same tab.
				await page.route("**/release.json", (request) =>
					request.fulfill({ contentType: "application/json", body }),
				);
				await checkNow(page);
				assert.equal(await notice.isVisible(), false);
				await page.unroute("**/release.json");
			}
			// This contract tests connectivity-gated release polling. Keep transport
			// available for unrelated lazy UI assets; PWA tests cover real disconnection.
			let offlineReleaseRequests = 0;
			const countRelease = (request) => {
				if (new URL(request.url()).pathname === "/release.json")
					offlineReleaseRequests++;
			};
			page.on("request", countRelease);
			await page.evaluate(() => {
				Object.defineProperty(navigator, "onLine", {
					configurable: true,
					get: () => false,
				});
				window.dispatchEvent(new Event("offline"));
			});
			await page.clock.fastForward(5 * 60_000);
			assert.equal(
				offlineReleaseRequests,
				0,
				"offline status prevents release polling",
			);
			page.off("request", countRelease);
			assert.equal(
				await notice.isVisible(),
				false,
				"offline is not a release change",
			);
			await page.evaluate(() => {
				Reflect.deleteProperty(navigator, "onLine");
				window.dispatchEvent(new Event("online"));
			});
			await serve("B");
			await checkNow(page);
			await notice.waitFor({ state: "visible" });
			assert.equal(
				await notice.getAttribute("data-release"),
				original,
				"checking never replaces the loaded build identity",
			);
			await page.getByRole("button", { name: "Later", exact: true }).click();
			assert.equal(
				await page.locator("#site-update-button").isVisible(),
				false,
			);
			await page
				.getByRole("button", { name: "Show update", exact: true })
				.click();
			assert.equal(await page.locator("#site-update-button").isVisible(), true);
			for (const [width, height] of [
				[1280, 900],
				[390, 844],
			]) {
				// biome-ignore lint/performance/noAwaitInLoops: capture both widths on the affected route.
				await page.setViewportSize({ width, height });
				for (const colorScheme of ["light", "dark"]) {
					// biome-ignore lint/performance/noAwaitInLoops: capture each theme in the same page.
					await page.emulateMedia({ colorScheme });
					await assertUpdateNoticeLayout(notice);
					await notice.scrollIntoViewIfNeeded();
					if (process.env.UI_EVIDENCE_DIR)
						await page.screenshot({
							animations: "disabled",
							path: join(
								process.env.UI_EVIDENCE_DIR,
								`site-update-${route.replaceAll("/", "") || "portfolio"}-${width}-${colorScheme}.png`,
							),
						});
				}
			}
			await Promise.all([
				page.waitForEvent("load"),
				page
					.getByRole("button", { name: "Update and reload", exact: true })
					.click(),
			]);
			await page.waitForFunction(
				(sha) =>
					document.querySelector("#site-update-notice")?.dataset.release ===
					sha,
				NEXT_SHA,
			);
			await page.clock.fastForward(5 * 60_000);
			assert.equal(
				await notice.isVisible(),
				false,
				"new release has no reload loop",
			);
			// An A recipe tab can finish a background browse against deployment B.
			// Verify the explicit release conflict rather than hiding its diagnostic.
			for (const value of conflicts) {
				const url = new URL(value);
				assert.equal(route, "/recipes/");
				assert.equal(url.pathname, "/api/recipe-browse/");
				assert.equal(url.searchParams.get("release"), original);
			}
			assert.deepEqual(
				errors,
				conflicts.map(
					() =>
						"Failed to load resource: the server responded with a status of 409 (Conflict)",
				),
			);
		} finally {
			await context.close();
		}
	});
}

for (const route of ROUTES) updateCheck(route);

async function checkNow(page) {
	const response = page.waitForResponse("**/release.json");
	await page.clock.fastForward(35 * 60_000);
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await response;
}

async function openOldPage(context) {
	const page = await context.newPage();
	await page.clock.install();
	await page.goto(`${site.origin}/`);
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	await page.evaluate(() => {
		window.loadedSentinel = true;
	});
	return page;
}

it("Later suppresses the same release, keeps keyboard reopen and announces distinct C", async () => {
	await serve("A");
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		const page = await openOldPage(context);
		await serve("B");
		await checkNow(page);
		const update = page.locator("#site-update-button");
		await update.waitFor({ state: "visible" });
		await page.getByRole("button", { name: "Later", exact: true }).click();
		assert.equal(
			await page
				.locator("#site-update-show")
				.evaluate((node) => node === document.activeElement),
			true,
		);
		await checkNow(page);
		assert.equal(
			await update.isVisible(),
			false,
			"polling B does not reopen dismissed B",
		);
		await page.locator("#site-update-show").press("Enter");
		assert.equal(
			await update.evaluate((node) => node === document.activeElement),
			true,
		);
		await page.getByRole("button", { name: "Later", exact: true }).click();
		await serve("C");
		await checkNow(page);
		await update.waitFor({ state: "visible" });
		assert.equal(
			await page.evaluate(() => window.loadedSentinel),
			true,
			"C announcement never reloads A",
		);
	} finally {
		await context.close();
	}
});

it("Update click revalidates unavailable or changed targets and recovers without losing the old page", async () => {
	await serve("A");
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		const page = await openOldPage(context);
		await serve("B");
		await checkNow(page);
		const update = page.locator("#site-update-button");
		await update.waitFor({ state: "visible" });
		await page.route("**/release.json", (route) =>
			route.fulfill({ status: 503, body: "unavailable" }),
		);
		await update.click();
		await page.waitForFunction(
			() => !document.querySelector("#site-update-button").disabled,
		);
		assert.equal(await page.evaluate(() => window.loadedSentinel), true);
		await page.unroute("**/release.json");
		await serve("C");
		await update.click();
		await page.waitForFunction(
			() => !document.querySelector("#site-update-button").disabled,
		);
		assert.equal(
			await page.evaluate(() => window.loadedSentinel),
			true,
			"changed B target requires another explicit click",
		);
		await Promise.all([page.waitForEvent("load"), update.click()]);
		await page.waitForFunction(
			(sha) =>
				document.querySelector("#site-update-notice").dataset.release === sha,
			THIRD_SHA,
		);
	} finally {
		await context.close();
	}
});

it("Stale HTML after explicit reload offers recovery and never loops automatically", async () => {
	await serve("A");
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		const page = await openOldPage(context);
		await page.route("**/release.json", (route) =>
			route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({ sha: NEXT_SHA }),
			}),
		);
		await checkNow(page);
		const update = page.locator("#site-update-button");
		await update.waitFor({ state: "visible" });
		let navigations = 0;
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) navigations += 1;
		});
		await Promise.all([page.waitForEvent("load"), update.click()]);
		await page.waitForFunction(
			() =>
				!window.loadedSentinel && !document.querySelector("astro-island[ssr]"),
		);
		await update.waitFor({ state: "visible" });
		await page.clock.fastForward(10 * 60_000);
		assert.equal(
			navigations,
			1,
			"stale intermediary cannot cause automatic reloads",
		);
		await serve("B");
		await Promise.all([page.waitForEvent("load"), update.click()]);
		await page.waitForFunction(
			(sha) =>
				document.querySelector("#site-update-notice").dataset.release === sha,
			NEXT_SHA,
		);
	} finally {
		await context.close();
	}
});

it("Metadata MIME, redirects, HTTP errors and timeout cannot invent an update; polling resumes after hidden and offline periods", async () => {
	await serve("A");
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		const page = await openOldPage(context);
		const notice = page.locator("#site-update-notice");
		for (const response of [
			{ contentType: "text/html", body: JSON.stringify({ sha: NEXT_SHA }) },
			{
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({ sha: NEXT_SHA }),
			},
			{ status: 302, headers: { location: "/login.json" } },
		]) {
			// biome-ignore lint/performance/noAwaitInLoops: each invalid response is observed independently.
			await page.route("**/release.json", (route) => route.fulfill(response));
			await checkNow(page);
			assert.equal(await notice.isVisible(), false);
			await page.unroute("**/release.json");
		}
		let requestObserved;
		const withheld = new Promise((resolve) => {
			requestObserved = resolve;
		});
		await page.route("**/release.json", () => {
			// Observe the actual withheld request before advancing its timeout.
			requestObserved();
		});
		const aborted = page.waitForEvent("requestfailed", {
			predicate: (request) => request.url().endsWith("/release.json"),
		});
		await page.clock.fastForward(35 * 60_000);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await withheld;
		await page.clock.fastForward(8_001);
		assert.ok(
			(await aborted).failure(),
			"the bounded release request actually aborts",
		);
		assert.equal(
			await notice.isVisible(),
			false,
			"timeout does not fabricate availability",
		);
		await page.unroute("**/release.json");
		let requests = 0;
		page.on("request", (request) => {
			if (request.url().endsWith("/release.json")) requests += 1;
		});
		await page.evaluate(() => {
			Object.defineProperty(document, "hidden", {
				configurable: true,
				get: () => true,
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await page.clock.fastForward(20 * 60_000);
		assert.equal(requests, 0, "hidden tab stops release requests");
		await context.setOffline(true);
		await page.evaluate(() => {
			Object.defineProperty(document, "hidden", {
				configurable: true,
				get: () => false,
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await page.clock.fastForward(20 * 60_000);
		assert.equal(requests, 0, "offline tab stops release requests");
		await serve("B");
		await context.setOffline(false);
		await page.evaluate(() => {
			for (let i = 0; i < 10; i += 1) window.dispatchEvent(new Event("focus"));
		});
		await notice.waitFor({ state: "visible" });
		assert.ok(
			requests <= 2,
			"foreground recovery coalesces reconnect/focus storms",
		);
	} finally {
		await context.close();
	}
});
