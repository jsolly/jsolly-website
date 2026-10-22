import assert from "node:assert/strict";
import {
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
