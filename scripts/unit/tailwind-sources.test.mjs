import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { globby } from "globby";
import { it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STYLESHEET = resolve(ROOT, "src/styles/main.css");
const SOURCE_ROOTS = [
	"src/components/",
	"src/layouts/",
	"src/pages/",
	"src/lib/",
];
// Content data and sanitizer modules hold prose rather than UI utilities.
const EXCLUDED = [
	"src/lib/blog/",
	"src/components/recipes/",
	"src/pages/recipes/",
];
// The shared stylesheet scans all installed shadcn-svelte parts.
const UI_DIR = "src/lib/components/ui/";
const UI_IMPORT =
	/["'][^"']*lib\/components\/ui\/(?<file>[\w-]+\.svelte)["']/gu;

// UI files imported by the site, excluding content data and the UI parts themselves.
async function siteUiImports() {
	const files = (
		await globby(
			SOURCE_ROOTS.map((root) => `${root}**/*.{astro,svelte,ts,js,mjs}`),
			{ cwd: ROOT },
		)
	).filter(
		(file) =>
			!(
				file.startsWith(UI_DIR) ||
				EXCLUDED.some((path) => file.startsWith(path))
			),
	);
	const sources = await Promise.all(
		files.map((file) => readFile(resolve(ROOT, file), "utf8")),
	);
	return new Set(
		sources.flatMap((source) =>
			[...source.matchAll(UI_IMPORT)].map(
				(match) => `${UI_DIR}${match.groups.file}`,
			),
		),
	);
}

// The same source resolution @tailwindcss/vite performs for a stylesheet.
async function scan() {
	const compiler = await compile(await readFile(STYLESHEET, "utf8"), {
		base: resolve(ROOT, "src/styles"),
		onDependency: () => undefined,
	});
	const scanner = new Scanner({ sources: compiler.sources });
	scanner.scan();
	return {
		root: compiler.root,
		files: scanner.files.map((file) => relative(ROOT, file)),
	};
}

it("Tailwind builds the shared stylesheet only from the four UI source roots", async () => {
	const { root: tailwindRoot, files } = await scan();
	assert.equal(
		tailwindRoot,
		"none",
		"main.css must import Tailwind with source(none), or automatic detection scans the whole repo",
	);
	const outside = files.filter(
		(file) => !SOURCE_ROOTS.some((root) => file.startsWith(root)),
	);
	assert.deepEqual(
		outside,
		[],
		"files outside the UI source roots feed main.css",
	);
	const excludedFiles = files.filter((file) =>
		EXCLUDED.some((path) => file.startsWith(path)),
	);
	assert.deepEqual(excludedFiles, [], "content-only data paths feed main.css");
	const used = await siteUiImports();
	assert.ok(used.size > 0, "site code imports shared ui components");
	assert.deepEqual(
		[...used].filter((file) => !files.includes(file)),
		[],
		"every directly used UI component is scanned",
	);
	const uiFiles = await globby(`${UI_DIR}**/*.svelte`, { cwd: ROOT });
	assert.deepEqual(
		files
			.filter((file) => file.startsWith(UI_DIR))
			.sort((a, b) => a.localeCompare(b)),
		uiFiles.sort((a, b) => a.localeCompare(b)),
		"all composed UI parts are scanned",
	);
	for (const component of [
		"src/components/SiteNavigation.svelte",
		"src/components/blog/BlogNavigation.svelte",
		"src/components/SiteShell.astro",
	]) {
		assert.ok(files.includes(component), `${component} is scanned`);
	}
	const unscannedRoots = SOURCE_ROOTS.filter(
		(root) => !files.some((file) => file.startsWith(root)),
	);
	assert.deepEqual(unscannedRoots, [], "every UI source root is scanned");
});
