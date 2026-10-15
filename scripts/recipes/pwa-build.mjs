// Writes the recipe app's service worker, dist/recipes/service-worker.js,
// which the recipe pages register with scope /recipes/ (plan §1.6). It runs in
// `npm run build` after process-html.mjs, so the snapshot covers the HTML as
// served.
//
// The worker (scripts/recipes/service-worker.js) precaches one complete built
// snapshot: every file under dist/recipes/ (the recipe pages, the recipe
// media, the manifest and icons, and the two assistant downloads) and every
// file those pages load (scripts, styles, fonts, images, the favicon and the
// no-JavaScript stylesheets inside <noscript>). A changed snapshot gets a new
// cache name. The new worker waits for an explicit Update and reload request
// or until every recipe tab closes. Only the requesting tab reloads immediately.
//
// A maintenance build (MAINTENANCE_MODE=true) writes no worker: installed
// workers then get a 404 on their update check, which leaves them and their
// caches as they were, instead of precaching the maintenance page. Any other
// build whose landing page links no recipe app manifest fails, since its
// worker would precache pages that cannot install the app.
//
//   node scripts/recipes/pwa-build.mjs [dist]
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import {
	PWA_FILES_PATH,
	PWA_WORKER_PATH,
	RECIPES_PATH,
} from "../../src/components/recipes/constants.mjs";

const WORKER_SOURCE = new URL("service-worker.js", import.meta.url);
// Every recipe app cache name starts with this; the worker deletes older ones.
const CACHE_PREFIX = "recipe-pages-pwa-";
const MANIFEST = `${PWA_FILES_PATH}manifest.webmanifest`;
// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
const MANIFEST_LINK = 'link[rel="manifest"]';
// Any origin works: it only resolves relative URLs to same-site paths.
const BASE = "https://recipe.invalid";
// The elements whose src or href a page loads.
const PAGE_RESOURCES =
	// biome-ignore lint/security/noSecrets: a CSS selector, not credential material.
	'[src], link[rel="stylesheet"], link[rel="alternate"][type="text/markdown"], link[rel="modulepreload"], link[rel="manifest"], link[rel="apple-touch-icon"], link[rel="icon"]';
// Files a script or stylesheet names: quoted script, style and font paths
// (the minifier quotes some strings with backticks) and CSS url()s.
const QUOTED_ASSET = /["'`](?<path>[^"'`\s]+\.(?:js|css|woff2?))["'`]/gu;
const CSS_URL = /url\(["']?(?<path>[^\s)"']+)["']?\)/gu;
const WHITESPACE = /\s+/u;
const SCRIPT_OR_STYLE = /\.(?:js|css)$/u;
const INDEX_FILE = /(?<=^|\/)index\.html$/u;

// The URLs the page at `page` loads, as [value, base] pairs, and whether it
// links the recipe app's manifest.
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
		return {
			references: values.filter(Boolean).map((value) => [value, page]),
			linksApp: [...document.querySelectorAll(MANIFEST_LINK)].some(
				(link) => link.getAttribute("href") === MANIFEST,
			),
		};
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
 * it precaches. Throws when the landing page links no recipe app manifest.
 */
export async function buildRecipePwa(root) {
	// Every file under /recipes/, a page (…/index.html) as its /…/ path.
	const local = (await globby("**/*", { cwd: join(root, RECIPES_PATH) })).map(
		(file) => `${RECIPES_PATH}${file.replace(INDEX_FILE, "")}`,
	);
	const pages = await Promise.all(
		local
			.filter((path) => path.endsWith("/"))
			.map(async (page) => ({
				page,
				...pageReferences(await readFile(fileOf(root, page), "utf8"), page),
			})),
	);
	if (!pages.find(({ page }) => page === RECIPES_PATH)?.linksApp) {
		throw new Error(
			`pwa-build: ${RECIPES_PATH} links no ${MANIFEST}; RecipeLayout should add it.`,
		);
	}
	const files = new Map();
	await collect(
		root,
		[
			...local.map((path) => [path, "/"]),
			...pages.flatMap(({ references }) => references),
		],
		files,
	);
	const assets = [...files.keys()].sort();
	const bundled = await build({
		entryPoints: [fileURLToPath(WORKER_SOURCE)],
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
	});
	const workerCode = bundled.outputFiles[0].text;
	const hash = createHash("sha256");
	// A changed negotiation/cache policy is a new snapshot too.
	hash.update(workerCode);
	for (const path of assets) hash.update(path).update(files.get(path));
	const cache = `${CACHE_PREFIX}${hash.digest("hex").slice(0, 20)}`;
	const digests = assets.map((path) => [
		path,
		{
			sha256: createHash("sha256").update(files.get(path)).digest("hex"),
			size: files.get(path).byteLength,
		},
	]);
	const constants = [
		`const CACHE = ${JSON.stringify(cache)};`,
		`const RELEASE = ${JSON.stringify(JSON.parse(await readFile(join(root, "release.json"), "utf8")).sha)};`,
		`const PREFIX = ${JSON.stringify(CACHE_PREFIX)};`,
		`const ASSET_DIGESTS = new Map(${JSON.stringify(digests)});`,
		"const ASSETS = new Set(ASSET_DIGESTS.keys());",
	].join("\n");
	await writeFile(join(root, PWA_WORKER_PATH), `${constants}\n${workerCode}`);
	return { cache, urls: assets };
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
