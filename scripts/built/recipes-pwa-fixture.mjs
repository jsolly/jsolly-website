import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { buildRecipePwa } from "../recipes/pwa-build.mjs";
import { serveStatic } from "./pages.mjs";

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
// Vary: Accept. The worker uses explicit Accept keys for each representation.
// The worker
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
const RELEASE_ATTRIBUTE = /data-release="[a-f0-9]{40}"/u;
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
const UNSAVED_CONFIRMATION = /cook|check|unsaved/iu;
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
	const release = label.toLowerCase().repeat(40);
	await writeFile(
		join(directory, "release.json"),
		JSON.stringify({ sha: release }),
	);
	await Promise.all(
		RECIPE_PAGES.map(async (route) => {
			const file = join(directory, route, "index.html");
			await writeFile(
				file,
				(await readFile(file, "utf8")).replace(
					RELEASE_ATTRIBUTE,
					`data-release="${release}"`,
				),
			);
		}),
	);
	// Real distinct frontend bundles: A's deferred module is absent from B.
	await writeFile(
		join(directory, `_astro/pwa-deferred-${label}.js`),
		`export const label = "Cooking tool ${label}";`,
	);
	await writeFile(
		join(directory, `_astro/pwa-entry-${label}.js`),
		`document.getElementById("pwa-deferred-action").addEventListener("click", async (event) => { const { label } = await import("./pwa-deferred-${label}.js"); event.target.textContent = label; });`,
	);
	const landing = join(directory, LANDING, "index.html");
	await writeFile(
		landing,
		(await readFile(landing, "utf8"))
			.replace(
				"</head>",
				`<meta name="pwa-test-snapshot" content="${label}"><script type="module" src="/_astro/pwa-entry-${label}.js"></script></head>`,
			)
			.replace(
				"</body>",
				'<button id="pwa-deferred-action">Load saved cooking tool</button></body>',
			),
	);
	if (label === "B") {
		await mkdir(join(directory, "recipes/new-release"), { recursive: true });
		await writeFile(
			join(directory, "recipes/new-release/index.html"),
			await readFile(landing),
		);
	}
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
	snapshots.C = await snapshot("C");
	// Frozen deployed worker source from 7ba3b818e40043f67858d5e70e9b8866e079aaea,
	// scripts/recipes/service-worker.js. Keep its lack of message handshakes
	// and client metadata intact. New-client A HTML represents the first reopen
	// needed by users whose original old document has no update detector.
	const legacy = join(fixture, "legacy");
	await cp(snapshots.A.directory, legacy, { recursive: true });
	const legacyCache = "recipe-pages-pwa-legacy-7ba3b81";
	const legacySource = await readFile(
		new URL("fixtures/recipe-worker-7ba3b81.txt", import.meta.url),
		"utf8",
	);
	const legacyBundle = await build({
		stdin: {
			contents: legacySource,
			resolveDir: fileURLToPath(new URL("../recipes/", import.meta.url)),
			sourcefile: "service-worker.js",
		},
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
	});
	await writeFile(
		join(legacy, WORKER),
		`const CACHE = ${JSON.stringify(legacyCache)};\nconst PREFIX = "recipe-pages-pwa-";\nconst ASSETS = new Set(${JSON.stringify(snapshots.A.urls)});\n${legacyBundle.outputFiles[0].text}`,
	);
	snapshots.legacy = { ...snapshots.A, directory: legacy, cache: legacyCache };
	const broken = join(fixture, "broken");
	await cp(snapshots.B.directory, broken, { recursive: true });
	await rm(join(broken, MISSING_FILE));
	snapshots.broken = { ...snapshots.B, directory: broken };
	// Complete HTTP200 bodies from a different deployment must not be accepted
	// merely because each fetch succeeded. Preserve the generated worker bytes.
	for (const [label, original] of [
		["mixed", "B"],
		["rollback", "A"],
	]) {
		const directory = join(fixture, label);
		// biome-ignore lint/performance/noAwaitInLoops: each isolated deployment copy has its own immutable worker/cache identity.
		await cp(snapshots[original].directory, directory, { recursive: true });
		await writeFile(
			join(directory, DATA_FILES[0]),
			await readFile(join(snapshots.C.directory, DATA_FILES[0])),
		);
		snapshots[label] = { ...snapshots[original], directory };
	}

	const oversized = join(fixture, "oversized");
	await cp(snapshots.B.directory, oversized, { recursive: true });
	const oversizedData = JSON.parse(
		await readFile(join(oversized, DATA_FILES[0]), "utf8"),
	);
	await writeFile(
		join(oversized, DATA_FILES[0]),
		JSON.stringify({
			...oversizedData,
			unexpectedPadding: "x".repeat(1024 * 1024),
		}),
	);
	snapshots.oversized = { ...snapshots.B, directory: oversized };
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

// SSR controls exist before their saved/query settings and handlers are ready.
async function navigateHydrated(page, url) {
	if (url) await page.goto(url);
	else await page.reload();
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
}

export {
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
	UNSAVED_CONFIRMATION,
	VIEWPORTS,
	WORKER,
	waitForBrowserState,
};
