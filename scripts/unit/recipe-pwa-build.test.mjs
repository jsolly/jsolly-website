import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { buildRecipePwa } from "../recipes/pwa-build.mjs";

const UNEXPECTED_PIN = /unexpected deployment pin/u;

it("worker manifests retain no-script, responsive and island resources without collecting inert markup", async () => {
	const root = mkdtempSync(join(tmpdir(), "recipe-pwa-build-"));
	const files = {
		"release.json": JSON.stringify({ sha: "a".repeat(40) }),
		"recipes/pwa/manifest.webmanifest": "{}",
		"recipes/index.html": `<!doctype html><html><head>
<link rel="MANIFEST" href="/recipes/pwa/manifest.webmanifest">
<link rel="ALTERNATE" type="TEXT/MARKDOWN" href="/recipes/index.md">
<link rel="alternate" type="text/html" href="/not-a-resource.html">
<noscript><link rel="STYLESHEET" href="/fallback.css"></noscript>
<script type="module" src="/_astro/entry.js"></script>
<link rel="modulepreload" href="/_astro/preload.js">
<link rel="icon" href="/icon.svg"><link rel="apple-touch-icon" href="/touch.svg">
<link rel="stylesheet" href="/ignored-query.css?v=1">
</head><body>
<astro-island component-url="/_astro/component.js" renderer-url="/_astro/renderer.js"></astro-island>
<img src="/thumb.svg" srcset="/small.svg 1x, /big.svg 2x"><source srcset="/wide.svg 2x">
<img src="" href="/missing-fallback.svg"><img src="https://example.invalid/remote.svg">
<template><img src="/missing-template.svg"><astro-island component-url="/missing-template.js"></astro-island></template>
<a href="/not-a-resource/">Navigation</a></body></html>`,
		"recipes/index.md": "# Recipes\n",
		"recipes/carrot-cake/index.html": "<h1>Carrot cake retirement notice</h1>",
		"recipes/carrot-cake.md": "# Carrot cake retirement notice\n",
		"recipes/test-recipe/index.html": `<!doctype html><html><body>
<img src="/recipes/media/photo.svg" srcset="/recipes/media/small.svg 1x, /recipes/media/large.svg 2x">
<astro-island component-url="/_astro/component.js" renderer-url="/_astro/renderer.js"></astro-island>
</body></html>`,
		"recipes/data/packs/test-recipe.json": JSON.stringify({
			releaseId: "a".repeat(40),
			recipe: { id: "test-recipe" },
		}),
		"_astro/entry.js": "export {};",
		"_astro/preload.js": "export {};",
		"_astro/component.js": "export {};",
		"_astro/renderer.js": "export {};",
		"fallback.css": "body { color: black; }",
	};
	for (const file of [
		"icon.svg",
		"touch.svg",
		"thumb.svg",
		"small.svg",
		"big.svg",
		"wide.svg",
		"recipes/media/photo.svg",
		"recipes/media/small.svg",
		"recipes/media/large.svg",
	]) {
		files[file] = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
	}
	try {
		for (const [file, contents] of Object.entries(files)) {
			mkdirSync(dirname(join(root, file)), { recursive: true });
			writeFileSync(join(root, file), contents);
		}
		const { urls } = await buildRecipePwa(root);
		assert.deepEqual(urls, [
			"/_astro/component.js",
			"/_astro/entry.js",
			"/_astro/preload.js",
			"/_astro/renderer.js",
			"/big.svg",
			"/fallback.css",
			"/icon.svg",
			"/recipes/",
			"/recipes/index.md",
			"/recipes/pwa/manifest.webmanifest",
			"/small.svg",
			"/thumb.svg",
			"/touch.svg",
			"/wide.svg",
		]);
		const recipe = JSON.parse(
			readFileSync(join(root, "recipes/data/offline/test-recipe.json"), "utf8"),
		);
		assert.equal(
			existsSync(join(root, "recipes/data/offline/carrot-cake.json")),
			false,
			"retirement notices need neither a detail pack nor a new saved-recipe manifest",
		);
		assert.equal(recipe.image, "/recipes/media/photo.svg");
		assert.deepEqual(recipe.imagePaths, [
			"/recipes/media/photo.svg",
			"/recipes/media/small.svg",
			"/recipes/media/large.svg",
		]);
		assert.deepEqual(
			recipe.assets.map(([file]) => file),
			[
				"/_astro/component.js",
				"/_astro/entry.js",
				"/_astro/preload.js",
				"/_astro/renderer.js",
				"/recipes/data/packs/test-recipe.json",
				"/recipes/media/photo.svg",
				"/recipes/test-recipe/",
			],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("each PWA rebuild refreshes shared asset digests while recipe graphs remain independent", async () => {
	const root = mkdtempSync(join(tmpdir(), "recipe-pwa-rebuild-"));
	const release = "a".repeat(40);
	const files = {
		"release.json": JSON.stringify({ sha: release }),
		"recipes/index.html":
			'<link rel="manifest" href="/recipes/pwa/manifest.webmanifest">',
		"recipes/pwa/manifest.webmanifest": "{}",
		"shared.css": "body { color: black; }",
		"one.js": 'export const recipe = "one";',
		"two.js": 'export const recipe = "two";',
	};
	for (const id of ["one", "two"]) {
		files[`recipes/${id}/index.html`] =
			`<link rel="stylesheet" href="/shared.css"><script src="/${id}.js"></script>`;
		files[`recipes/data/packs/${id}.json`] = JSON.stringify({
			releaseId: release,
			recipe: { id },
		});
	}
	const manifest = (id) =>
		JSON.parse(
			readFileSync(join(root, `recipes/data/offline/${id}.json`), "utf8"),
		);
	try {
		for (const [file, bytes] of Object.entries(files)) {
			mkdirSync(dirname(join(root, file)), { recursive: true });
			writeFileSync(join(root, file), bytes);
		}
		const first = await buildRecipePwa(root);
		const original = manifest("one").assets.find(
			([path]) => path === "/shared.css",
		)[1];
		writeFileSync(join(root, "shared.css"), "body { color: rebeccapurple; }");
		const second = await buildRecipePwa(root);
		assert.notEqual(first.cache, second.cache);
		for (const [id, other] of [
			["one", "two"],
			["two", "one"],
		]) {
			const assets = new Map(manifest(id).assets);
			assert.notDeepEqual(assets.get("/shared.css"), original);
			assert.ok(assets.has(`/${id}.js`));
			assert.equal(assets.has(`/${other}.js`), false);
		}
		assert.deepEqual(
			new Map(manifest("one").assets).get("/shared.css"),
			new Map(manifest("two").assets).get("/shared.css"),
		);
		rmSync(join(root, "shared.css"));
		await assert.rejects(buildRecipePwa(root), { code: "ENOENT" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("pinned PWA builds retain transitive modules, CSS fonts and saved-view lazy chunks without admitting unrelated queries", async () => {
	const root = mkdtempSync(join(tmpdir(), "recipe-pwa-pinned-"));
	const deploymentId = "dpl_fixture_A";
	const files = {
		"release.json": JSON.stringify({ sha: "a".repeat(40) }),
		"recipes/pwa/manifest.webmanifest": "{}",
		"recipes/index.html": `<link rel="manifest" href="/recipes/pwa/manifest.webmanifest"><link rel="stylesheet" href="/_astro/styles.css?dpl=${deploymentId}"><script type="module" src="/_astro/entry.js?dpl=${deploymentId}"></script><link rel="stylesheet" href="/_astro/missing.css?v=1">`,
		"recipes/test-recipe/index.html": `<astro-island component-url="/_astro/entry.js?dpl=${deploymentId}" renderer-url="/_astro/shared.js?dpl=${deploymentId}"></astro-island>`,
		"recipes/data/packs/test-recipe.json": "{}",
		"_astro/entry.js": `import './shared.js?dpl=${deploymentId}'; export const later = () => import(\`./lazy.js?dpl=${deploymentId}\`);`,
		"_astro/shared.js": "export const value = 1;",
		"_astro/lazy.js": "export const later = 2;",
		"_astro/styles.css": `:root{--tw-content:""}@font-face{font-family:Fixture;src:url(/_astro/font.abc.woff2?dpl=${deploymentId})format("woff2")}`,
		"_astro/font.abc.woff2": "fixture-font-bytes",
	};
	try {
		for (const [file, bytes] of Object.entries(files)) {
			mkdirSync(dirname(join(root, file)), { recursive: true });
			writeFileSync(join(root, file), bytes);
		}
		const { urls } = await buildRecipePwa(root, { deploymentId });
		for (const asset of [
			"entry.js",
			"shared.js",
			"styles.css",
			"font.abc.woff2",
		]) {
			assert.ok(urls.includes(`/_astro/${asset}`), asset);
		}
		assert.equal(
			urls.includes("/_astro/lazy.js"),
			false,
			"installation remains static-only",
		);
		const recipe = JSON.parse(
			readFileSync(join(root, "recipes/data/offline/test-recipe.json"), "utf8"),
		);
		assert.ok(recipe.assets.some(([path]) => path === "/_astro/lazy.js"));
		assert.ok(recipe.assets.every(([path]) => !path.includes("?")));
		writeFileSync(join(root, "_astro/shared.js"), "export const value = 3;");
		await buildRecipePwa(root, { deploymentId });
		const changed = JSON.parse(
			readFileSync(join(root, "recipes/data/offline/test-recipe.json"), "utf8"),
		);
		assert.notDeepEqual(
			new Map(changed.assets).get("/_astro/shared.js"),
			new Map(recipe.assets).get("/_astro/shared.js"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("PWA generation rejects a mismatched generated deployment pin", async () => {
	const root = mkdtempSync(join(tmpdir(), "recipe-pwa-wrong-pin-"));
	try {
		mkdirSync(join(root, "recipes/pwa"), { recursive: true });
		writeFileSync(
			join(root, "recipes/index.html"),
			// biome-ignore lint/security/noSecrets: fixture HTML contains no credentials.
			'<link rel="manifest" href="/recipes/pwa/manifest.webmanifest"><script src="/_astro/entry.js?dpl=other"></script>',
		);
		writeFileSync(join(root, "recipes/pwa/manifest.webmanifest"), "{}");
		await assert.rejects(
			buildRecipePwa(root, { deploymentId: "dpl_fixture_A" }),
			UNEXPECTED_PIN,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
