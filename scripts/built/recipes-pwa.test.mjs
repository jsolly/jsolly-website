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
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { buildRecipePwa } from "../recipes/pwa-build.mjs";
import { collectErrors, readBuilt, serveStatic } from "./pages.mjs";

// The recipe app offline, ported from awesome-blog's PWA suite
// (scripts/recipes/pwa.test.mjs): it installs and the cooking tools work
// offline at a desktop and a phone width, an update waits until every recipe
// tab closes, and a failed download keeps the previous snapshot or claims no
// readiness, while a maintenance deploy (no worker) leaves the installed app
// as it was. The server serves one fixed directory whose contents a test
// swaps between copies of dist/ with their own worker: A and B differ in a
// marker on /recipes/ and in the recipe data, "broken" is B with a precached
// icon missing, so its install fails, and "maintenance" is A without its
// worker, as a maintenance build ships (plan §1.6). Every response carries
// Vary: Accept, as middleware-negotiated HTML does (in Chromium the worker's
// bare-URL lookups match it with or without its ignoreVary). The worker
// controls /recipes/ only: blog and portfolio pages stay uncontrolled, and its
// snapshot holds no page outside /recipes/.
const DIST = "dist";
const LANDING = "/recipes/";
// Literals on purpose: these are the plan's decisions (§1.6), not whatever
// constants.mjs says.
const SCOPE = "/recipes/";
const WORKER = "/recipes/service-worker.js";
const DATA_FILES = [
	"/recipes/data/recipe-library.json",
	"/recipes/data/recipe-library.md",
];
const MISSING_FILE = "recipes/pwa/icon-512.png";
// The blog chrome the recipe pages show: the header logo and the author card.
const BLOG_CHROME =
	/^\/blog\/(?:topographic-logo\.svg|social\/\w+\.svg|media\/default\.webp)$/u;
const SNAPSHOT_META = 'meta[name="pwa-test-snapshot"]';
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const MANIFEST_LINK = 'link[rel="manifest"]';
const RECIPES = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const { recipes } = JSON.parse(await readFile(RECIPES, "utf8"));
const RECIPE_PAGES = [
	LANDING,
	"/recipes/meals/",
	"/recipes/smoothies/",
	...recipes.map(({ id }) => `/recipes/${id}/`),
];
const SERVINGS = /^Servings/u;
const SHARED_RECIPE =
	"/recipes/shawarma-chicken-bowls/?servings=8&starch=shawarma-chicken-bowls:pita_one";
const LEARN_MORE = "Learn more about Tabular Recipe Notation";
const SMOOTHIES = recipes.filter(({ type }) => type === "smoothie").length;
// RecipePwa's status line before any worker reports.
const INSTRUCTIONS =
	"Save recipes to your home screen. On iPhone or iPad, open in Safari and choose Share → Add to Home Screen. Other browsers offer Install or Add to Home Screen in their menu.";
const SAVED = "Recipes saved for offline use.";
const OFFLINE = "You are offline.";
const VIEWPORTS = [
	["desktop", { width: 1280, height: 900 }],
	["mobile", { width: 390, height: 844 }],
];
const WAIT_MS = 30_000;
const POLL_MS = 100;

let fixture;
let site;
let browser;
const snapshots = {};
let served;

// Copies dist/ to `label`, marks its landing page and recipe data with the
// label, and writes its worker twice: `worker` and `rebuilt` are the two
// results, which must match.
async function snapshot(label) {
	const directory = join(fixture, label);
	await cp(DIST, directory, { recursive: true });
	const landing = join(directory, LANDING, "index.html");
	await writeFile(
		landing,
		(await readFile(landing, "utf8")).replace(
			"</head>",
			`<meta name="pwa-test-snapshot" content="${label}"></head>`,
		),
	);
	const dataFile = join(directory, DATA_FILES[0]);
	const data = JSON.parse(await readFile(dataFile, "utf8"));
	await writeFile(dataFile, JSON.stringify({ ...data, testSnapshot: label }));
	const built = await buildRecipePwa(directory);
	const worker = await readFile(join(directory, WORKER), "utf8");
	await buildRecipePwa(directory);
	const rebuilt = await readFile(join(directory, WORKER), "utf8");
	return { directory, ...built, worker, rebuilt };
}

before(async () => {
	fixture = await mkdtemp(join(tmpdir(), "recipe-pwa-test-"));
	snapshots.A = await snapshot("A");
	snapshots.B = await snapshot("B");
	const broken = join(fixture, "broken");
	await cp(snapshots.B.directory, broken, { recursive: true });
	await rm(join(broken, MISSING_FILE));
	snapshots.broken = { ...snapshots.B, directory: broken };
	const maintenance = join(fixture, "maintenance");
	await cp(snapshots.A.directory, maintenance, { recursive: true });
	await rm(join(maintenance, WORKER));
	snapshots.maintenance = { ...snapshots.A, directory: maintenance };
	served = join(fixture, "served");
	await serve("A");
	site = await serveStatic(served, {
		Vary: "Accept",
		"Cache-Control": "no-store",
	});
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
	if (fixture) await rm(fixture, { recursive: true, force: true });
});

// Points the served directory at snapshot `label`'s files. Renaming a fresh
// link over the old one swaps them in one step, so no request ever sees a
// half-copied tree.
async function serve(label) {
	const next = `${served}.next`;
	await symlink(snapshots[label].directory, next, "dir");
	await rename(next, served);
}

// Playwright's waitForFunction polls synchronous predicates; this awaits the
// browser-side service worker and cache reads before judging the condition.
async function waitForBrowserState(page, predicate, argument) {
	const deadline = Date.now() + WAIT_MS;
	while (Date.now() < deadline) {
		// biome-ignore lint/performance/noAwaitInLoops: polling must be sequential.
		if (await page.evaluate(predicate, argument)) return;
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	throw new Error(
		`Browser state did not reach the condition within ${WAIT_MS}ms`,
	);
}

const statusText = (page, text) =>
	page.getByText(text, { exact: false }).waitFor({ state: "attached" });
const snapshotLabel = (page) =>
	page.locator(SNAPSHOT_META).getAttribute("content");
const dataLabel = (page) =>
	page.evaluate(
		async (path) => (await (await fetch(path)).json()).testSnapshot,
		DATA_FILES[0],
	);
// The HTTP status each of `paths` answers with, fetched from `page`.
const statuses = (page, paths) =>
	page.evaluate(
		(urls) => Promise.all(urls.map(async (url) => (await fetch(url)).status)),
		paths,
	);
const controlled = (page) =>
	page.evaluate(() => navigator.serviceWorker.controller !== null);
const noUpdateWaiting = (page) =>
	page.evaluate(
		async () =>
			(await navigator.serviceWorker.getRegistration()).waiting === null,
	);

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
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (["warning", "error"].includes(message.type())) {
				errors.push(message.text());
			}
		});
		try {
			await page.goto(`${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			await page.waitForFunction(() => navigator.serviceWorker.controller);
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

			await context.setOffline(true);
			await page.reload();
			await statusText(page, OFFLINE);
			await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
			await page
				.locator(".recipe-card")
				.filter({ hasText: "Lemon salmon and asparagus" })
				.getByRole("link", { name: "See recipe" })
				.click();
			await page.locator(".recipe-detail .reset-checks-row").waitFor();
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
			await page.goto(`${site.origin}${LANDING}?cooking=1#meal-results`);
			const servings = page.getByRole("combobox", { name: SERVINGS });
			await servings.waitFor();
			assert.equal(await servings.inputValue(), "2");
			// A shared recipe link opens offline with its settings, and its
			// notation dialog still opens.
			await page.goto(`${site.origin}${SHARED_RECIPE}`);
			await page.locator(".recipe-detail .reset-checks-row").waitFor();
			assert.equal(
				await page.getByRole("combobox", { name: SERVINGS }).inputValue(),
				"8",
			);
			await page.getByRole("button", { name: LEARN_MORE, exact: true }).click();
			await page.locator(".method-dialog").waitFor();
			// So does a collection page.
			await page.goto(`${site.origin}/recipes/smoothies/`);
			await page.locator("[data-hydrated=true]").waitFor();
			assert.equal(await page.locator(".recipe-card").count(), SMOOTHIES);
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
			for (const path of ["/blog/", "/about/"]) {
				// biome-ignore lint/performance/noAwaitInLoops: one page at a time in the one tab
				await page.goto(`${site.origin}${path}`);
				assert.equal(await controlled(page), false, `${path} is controlled`);
			}
		} finally {
			await context.close();
		}
	});
}

for (const [name, viewport] of VIEWPORTS) installCheck(name, viewport);

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
			await page.goto(`${site.origin}${LANDING}`);
			await statusText(page, SAVED);
			assert.equal(await snapshotLabel(page), "A");
		}
		await serve("B");
		await tabs[0].evaluate(async () => {
			await (await navigator.serviceWorker.getRegistration()).update();
		});
		await statusText(tabs[0], "Updated recipes are downloaded.");
		await context.setOffline(true);
		for (const page of tabs) {
			// biome-ignore lint/performance/noAwaitInLoops: the tabs reload in turn
			await page.reload();
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
		const reopened = await context.newPage();
		// Wait for activation without relying on a network visit to establish it.
		await reopened.goto(`${site.origin}${LANDING}`);
		await waitForBrowserState(
			reopened,
			async () => !(await navigator.serviceWorker.getRegistration()).waiting,
		);
		await reopened.reload();
		assert.equal(await snapshotLabel(reopened), "B");
		assert.equal(await dataLabel(reopened), "B");
		assert.deepEqual(await reopened.evaluate(() => caches.keys()), [
			snapshots.B.cache,
		]);
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
		await page.goto(`${site.origin}${LANDING}`);
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
		await page.reload();
		assert.equal(await snapshotLabel(page), "A");
		await context.setOffline(false);
		await page.reload();
		await statusText(page, SAVED);

		await serve("broken");
		await page.evaluate(async () => {
			await (await navigator.serviceWorker.getRegistration()).update();
		});
		await statusText(page, "Update download failed.");
		await context.setOffline(true);
		await page.reload();
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
		await page.goto(`${site.origin}${LANDING}`);
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
		await page.goto(`${site.origin}${LANDING}`);
		await statusText(page, "Recipes could not be saved offline.");
		assert.equal(await controlled(page), false);
	} finally {
		await context.close();
	}
});
