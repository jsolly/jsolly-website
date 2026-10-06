// Writes the recipe app's service worker, dist/recipes/service-worker.js,
// which the recipe pages register with scope /recipes/ (plan §1.6). It runs in
// `npm run build` after process-html.mjs, so the snapshot covers the HTML as
// served.
//
// The worker precaches one complete built snapshot: the landing, collection
// and recipe pages, every file they load (scripts, styles, fonts, images,
// the manifest and icons, and the no-JavaScript stylesheets inside
// <noscript>), the recipe media and the two assistant downloads. A changed
// snapshot gets a new cache name, and the new worker waits until every recipe
// tab closes, so new HTML never mixes with an older bundle mid-recipe.
//
// A maintenance build (MAINTENANCE_MODE=true) writes no worker: installed
// workers then get a 404 on their update check, which leaves them and their
// caches as they were, instead of precaching the maintenance page.
//
//   node scripts/recipes/pwa-build.mjs [dist]
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import {
	COLLECTION_PATHS,
	PWA_FILES_PATH,
	PWA_WORKER_PATH,
	RECIPE_DATA_FILES,
	RECIPE_MEDIA_PATH,
	RECIPES_PATH,
} from "../../src/components/recipes/constants.mjs";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};

// Every recipe app cache name starts with this; the worker deletes older ones.
const CACHE_PREFIX = "recipe-pages-pwa-";
// The pages the app works offline on.
const RECIPE_PAGES = [
	RECIPES_PATH,
	...Object.values(COLLECTION_PATHS),
	...data.recipes.map(({ id }) => `${RECIPES_PATH}${id}/`),
];
// Any origin works: it only resolves relative URLs to same-site paths.
const BASE = "https://recipe.invalid";
// The elements whose src or href a page loads.
const PAGE_RESOURCES =
	// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
	'[src], link[rel="stylesheet"], link[rel="modulepreload"], link[rel="manifest"], link[rel="apple-touch-icon"]';
// Files a script or stylesheet names: quoted script, style and font paths
// (the minifier quotes some strings with backticks) and CSS url()s.
const QUOTED_ASSET = /["'`](?<path>[^"'`\s]+\.(?:js|css|woff2?))["'`]/gu;
const CSS_URL = /url\(["']?(?<path>[^\s)"']+)["']?\)/gu;
const WHITESPACE = /\s+/u;
const SCRIPT_OR_STYLE = /\.(?:js|css)$/u;

// The URLs the page at `page` loads, as [value, base] pairs.
function pageReferences(html, page) {
	// jsdom runs no scripts, so <noscript> holds parsed elements: the offline
	// copy keeps the no-JavaScript stylesheets too.
	const { window } = new JSDOM(html);
	try {
		const { document } = window;
		const values = [];
		for (const element of document.querySelectorAll(PAGE_RESOURCES)) {
			values.push(element.getAttribute("src") ?? element.getAttribute("href"));
		}
		for (const element of document.querySelectorAll("[srcset]")) {
			for (const candidate of element.getAttribute("srcset").split(",")) {
				values.push(candidate.trim().split(WHITESPACE)[0]);
			}
		}
		for (const island of document.querySelectorAll("astro-island")) {
			values.push(
				island.getAttribute("component-url"),
				island.getAttribute("renderer-url"),
			);
		}
		return values.filter(Boolean).map((value) => [value, page]);
	} finally {
		window.close();
	}
}

// The URLs the script or stylesheet at `path` names, as [value, base] pairs.
function fileReferences(contents, path) {
	if (!SCRIPT_OR_STYLE.test(path)) return [];
	const source = contents.toString();
	return [...source.matchAll(QUOTED_ASSET), ...source.matchAll(CSS_URL)].map(
		(match) => [match.groups.path, path],
	);
}

// The same-origin path `value` names from `base`, or null for another origin
// or a URL with a query (neither is part of the snapshot).
function sitePath(value, base) {
	const url = new URL(value, `${BASE}${base}`);
	return url.origin === BASE && !url.search ? url.pathname : null;
}

const fileOf = (root, path) =>
	join(root, path.endsWith("/") ? `${path}index.html` : path);

// Reads every file `references` name into `files` (path → contents), then
// the files those name, until nothing new turns up. The worker is never part
// of its own snapshot: the client script names it, and a copied build may
// already hold an older one.
async function collect(root, references, files) {
	const paths = [
		...new Set(references.map(([value, base]) => sitePath(value, base))),
	].filter((path) => path && path !== PWA_WORKER_PATH && !files.has(path));
	if (paths.length === 0) return;
	const read = await Promise.all(
		paths.map(async (path) => [path, await readFile(fileOf(root, path))]),
	);
	for (const [path, contents] of read) files.set(path, contents);
	await collect(
		root,
		read.flatMap(([path, contents]) => fileReferences(contents, path)),
		files,
	);
}

/**
 * Writes `root`/recipes/service-worker.js for the build in `root` (dist/ or a
 * copy of it) and returns { cache, urls }: its cache name and the sorted paths
 * it precaches.
 */
export async function buildRecipePwa(root) {
	const pages = await Promise.all(
		RECIPE_PAGES.map(async (page) =>
			pageReferences(await readFile(fileOf(root, page), "utf8"), page),
		),
	);
	// All the recipe media (a recipe dialog picks image sizes the
	// server-rendered cards do not use) and the app's manifest and icons.
	const directories = await Promise.all(
		[RECIPE_MEDIA_PATH, PWA_FILES_PATH].map(async (directory) =>
			(await readdir(join(root, directory))).map((file) => [file, directory]),
		),
	);
	const files = new Map();
	await collect(
		root,
		[
			...["/favicon.ico", ...RECIPE_DATA_FILES, ...RECIPE_PAGES].map((path) => [
				path,
				"/",
			]),
			...pages.flat(),
			...directories.flat(),
		],
		files,
	);
	const assets = [...files.keys()].sort();
	const hash = createHash("sha256");
	for (const path of assets) hash.update(path).update(files.get(path));
	const cache = `${CACHE_PREFIX}${hash.digest("hex").slice(0, 20)}`;
	await writeFile(join(root, PWA_WORKER_PATH), workerSource(cache, assets));
	return { cache, urls: assets };
}

// The worker serves a precached path cache-first, a page only for a
// navigation to its exact /…/ path (any query or fragment). The lookup ignores
// Vary as a second safeguard (plan §1.13): the precached requests and the
// lookup are bare URLs, so a Vary: Accept response matches today, and it
// keeps matching should either side ever carry a navigation's Accept.
function workerSource(cache, assets) {
	return `const CACHE = ${JSON.stringify(cache)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const ASSETS = new Set(${JSON.stringify(assets)});
self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE).then((store) => store.addAll([...ASSETS])));
});
self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		for (const key of await caches.keys()) {
			if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
		}
		await self.clients.claim();
	})());
});
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
	const key = url.pathname;
	if (!ASSETS.has(key) || (event.request.mode === "navigate" && !key.endsWith("/"))) return;
	event.respondWith((async () => {
		const store = await caches.open(CACHE);
		return (await store.match(key, { ignoreVary: true })) || fetch(event.request);
	})());
});
`;
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const root = process.argv[2] ?? "./dist";
	if (process.env.MAINTENANCE_MODE === "true") {
		console.info("Maintenance build: no recipe service worker written.");
	} else {
		const { cache, urls } = await buildRecipePwa(root);
		console.info(
			`Wrote ${join(root, PWA_WORKER_PATH)}: ${cache}, ${urls.length} files.`,
		);
	}
}
