// Writes the recipe app's service worker, dist/recipes/service-worker.js,
// which the recipe pages register with scope /recipes/ (plan §1.6). It runs in
// `npm run build` after process-html.mjs, so the snapshot covers the HTML as
// served.
//
// Installation downloads only the app shell. Individual opened recipes get
// release-bound manifests for atomic, verified offline saves at runtime.
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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
// Release shell names share a prefix; complete historical shells remain read-only.
const CACHE_PREFIX = "recipe-pages-pwa-";
const SHELL_PAGES = new Set(["/recipes/", "/recipes/saved/"]);
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
const STATIC_IMPORT =
	/\b(?:import|export)\s*(?:[^;"'`()]*?\bfrom\s*)?["'`](?<path>[^"'`\s]+\.js)["'`]/gu;
const CSS_URL = /url\(["']?(?<path>[^\s)"']+)["']?\)/gu;
const FONT_FILE = /\.[^/.]+\.woff2?$/u;
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
function fileReferences(contents, path, dynamic = true) {
	if (!SCRIPT_OR_STYLE.test(path)) return [];
	const source = contents.toString();
	return [
		...source.matchAll(dynamic ? QUOTED_ASSET : STATIC_IMPORT),
		...source.matchAll(CSS_URL),
	].map((match) => [match.groups.path, path]);
}

// The same-origin path `value` names from `base`, or null for another origin
// or a URL with a query (neither is part of the snapshot).
function sitePath(value, base) {
	// Vite preload dependency tables use build-root paths without a leading slash.
	const reference = value.startsWith("_astro/") ? `/${value}` : value;
	const url = new URL(reference, `${BASE}${base}`);
	return url.origin === BASE && !url.search ? url.pathname : null;
}

const fileOf = (root, path) =>
	join(root, path.endsWith("/") ? `${path}index.html` : path);

// Reads every file `references` name into `files` (path → contents), then
// the files those name, until nothing new turns up. The worker is never part
// of its own snapshot: the client script names it, and a copied build may
// already hold an older one.
async function collect(root, references, files, dynamic = true) {
	const paths = [
		...new Set(references.map(([value, base]) => sitePath(value, base))),
	].filter((path) => path && path !== PWA_WORKER_PATH && !files.has(path));
	if (paths.length === 0) return;
	// Browsers capable of this service worker support WOFF2. Do not download
	// a second fallback encoding when the exact font has a WOFF2 resource.
	const modernFonts = new Set(
		[...paths, ...files.keys()]
			.filter((path) => path.endsWith(".woff2"))
			.map((path) => path.replace(FONT_FILE, "")),
	);
	const selected = paths.filter(
		(path) =>
			!path.endsWith(".woff") || !modernFonts.has(path.replace(FONT_FILE, "")),
	);
	const read = await Promise.all(
		selected.map(async (path) => [path, await readFile(fileOf(root, path))]),
	);
	for (const [path, contents] of read) files.set(path, contents);
	await collect(
		root,
		read.flatMap(([path, contents]) => fileReferences(contents, path, dynamic)),
		files,
		dynamic,
	);
}

function digest(contents) {
	return {
		sha256: createHash("sha256").update(contents).digest("hex"),
		size: contents.byteLength,
	};
}

/**
 * Writes `root`/recipes/service-worker.js for the build in `root` (dist/ or a
 * copy of it) and returns { cache, urls }: its cache name and the sorted paths
 * it precaches. Throws when the landing page links no recipe app manifest.
 */
export async function buildRecipePwa(root) {
	// Every file under /recipes/, a page (…/index.html) as its /…/ path.
	const local = (await globby("**/*", { cwd: join(root, RECIPES_PATH) }))
		.map((file) => `${RECIPES_PATH}${file.replace(INDEX_FILE, "")}`)
		.sort((a, b) => a.localeCompare(b));
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
	const shell = new Map();
	await collect(
		root,
		pages
			.filter(({ page }) => SHELL_PAGES.has(page))
			.flatMap(({ page, references }) => [
				[page, "/"],
				...references.filter(
					([value]) =>
						!value.startsWith("/recipes/media/") &&
						value !== "/blog/media/default.webp",
				),
			]),
		shell,
		false,
	);
	// Icons are named by the manifest JSON, not an HTML resource attribute.
	await collect(
		root,
		local
			.filter((path) => path.startsWith(PWA_FILES_PATH))
			.map((path) => [path, "/"]),
		shell,
		false,
	);
	const offlineApi = await globby("_astro/recipe-offline.*.js", { cwd: root });
	await collect(
		root,
		offlineApi.map((path) => [`/${path}`, "/"]),
		shell,
		false,
	);
	const savedTools = new Map();
	const summaryModules = await globby("_astro/recipe-summary.*.js", {
		cwd: root,
	});
	// Saving includes the shell's deferred controls, dialog and print tools.
	// The install graph above remains static-only. Following the saved graph
	// here also covers future lazy controls without naming generated chunks.
	await collect(
		root,
		[
			...[...shell.keys()]
				.filter((path) => path.endsWith(".js"))
				.map((path) => [path, "/"]),
			...summaryModules.map((path) => [`/${path}`, "/"]),
		],
		savedTools,
		true,
	);
	const release = JSON.parse(
		await readFile(join(root, "release.json"), "utf8"),
	).sha;
	const recipeManifests = {};
	await mkdir(join(root, "recipes/data/offline"), { recursive: true });
	const savedViewContents = Buffer.from(
		JSON.stringify({
			schemaVersion: 1,
			release,
			assets: [...savedTools.keys()]
				.filter((path) => !shell.has(path))
				.sort((a, b) => a.localeCompare(b))
				.map((path) => [path, digest(savedTools.get(path))]),
		}),
	);
	const savedViewPath = "/recipes/data/offline/_saved-view.json";
	await writeFile(fileOf(root, savedViewPath), savedViewContents);
	const savedViewManifest = {
		path: savedViewPath,
		...digest(savedViewContents),
	};
	for (const { page, references } of pages) {
		const id = page.slice(RECIPES_PATH.length, -1);
		if (!id || ["meals", "smoothies", "saved"].includes(id)) continue;
		const packPath = `/recipes/data/packs/${id}.json`;
		const recipeFiles = new Map(savedTools);
		const image = references.find(([value]) =>
			value.startsWith("/recipes/media/"),
		)?.[0];
		const chosen = references.filter(
			([value]) => !value.startsWith("/recipes/media/") || value === image,
		);
		// biome-ignore lint/performance/noAwaitInLoops: bound memory while collecting one independent recipe bundle.
		await collect(root, [[page, "/"], [packPath, "/"], ...chosen], recipeFiles);
		const manifest = {
			schemaVersion: 1,
			id,
			release,
			image,
			imagePaths: [
				...new Set(
					references
						.filter(([value]) => value.startsWith("/recipes/media/"))
						.map(([value]) => value),
				),
			],
			assets: [...recipeFiles.keys()]
				.sort()
				.map((resource) => [resource, digest(recipeFiles.get(resource))]),
		};
		const contents = Buffer.from(JSON.stringify(manifest));
		const path = `/recipes/data/offline/${id}.json`;
		await writeFile(fileOf(root, path), contents);
		recipeManifests[id] = { path, ...digest(contents) };
	}
	const assets = [...shell.keys()].sort();
	const bundled = await build({
		entryPoints: [fileURLToPath(WORKER_SOURCE)],
		bundle: true,
		minify: true,
		write: false,
		platform: "browser",
		format: "iife",
	});
	const workerCode = bundled.outputFiles[0].text;
	const hash = createHash("sha256");
	// A changed negotiation/cache policy is a new snapshot too.
	hash.update(workerCode);
	hash.update(JSON.stringify({ assets, recipeManifests, savedViewManifest }));
	for (const path of assets) hash.update(path).update(shell.get(path));
	const cache = `${CACHE_PREFIX}${hash.digest("hex").slice(0, 20)}`;
	const digests = assets.map((path) => [path, digest(shell.get(path))]);
	const constants = [
		`const CACHE = ${JSON.stringify(cache)};`,
		`const RELEASE = ${JSON.stringify(release)};`,
		`const PREFIX = ${JSON.stringify(CACHE_PREFIX)};`,
		`const ASSET_DIGESTS = new Map(${JSON.stringify(digests)});`,
		`const ASSETS = new Set(${JSON.stringify(assets)});`,
		`const RECIPE_MANIFESTS = ${JSON.stringify(recipeManifests)};`,
		`const SAVED_VIEW_MANIFEST = ${JSON.stringify(savedViewManifest)};`,
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
