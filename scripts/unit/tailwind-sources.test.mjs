import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { globby } from "globby";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STYLESHEET = resolve(ROOT, "src/styles/main.css");
const SOURCE_ROOTS = [
	"src/components/",
	"src/layouts/",
	"src/pages/",
	"src/lib/",
];
// Blog and recipe paths under the source roots must not feed main.css: the
// blog has its own Tailwind entry (src/styles/blog/ui.css), and recipe data and
// modules hold class-like strings that are not portfolio UI.
const EXCLUDED = [
	"src/lib/blog/",
	"src/components/blog/",
	"src/pages/blog/",
	"src/layouts/BlogLayout.astro",
	"src/components/recipes/",
	"src/pages/recipes/",
];
// The shared shadcn-svelte parts feed main.css only when portfolio code
// imports them; main.css excludes the directory and re-includes those files.
const UI_DIR = "src/lib/components/ui/";
const UI_IMPORT =
	/["'][^"']*lib\/components\/ui\/(?<file>[\w-]+\.svelte)["']/gu;

// The ui files portfolio code (the source roots minus the excluded paths and
// the ui directory itself) imports.
async function portfolioUiImports() {
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

it("Tailwind builds the portfolio stylesheet only from the four portfolio source roots", async () => {
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
		"files outside the portfolio source roots feed main.css",
	);
	const excludedFiles = files.filter((file) =>
		EXCLUDED.some((path) => file.startsWith(path)),
	);
	assert.deepEqual(
		excludedFiles,
		[],
		"blog or recipe paths feed main.css; keep their @source not lines",
	);
	const used = await portfolioUiImports();
	assert.ok(used.size > 0, "portfolio code imports shared ui components");
	assert.deepEqual(
		files.filter((file) => file.startsWith(UI_DIR)).sort(),
		[...used].sort(),
		"exactly the ui components portfolio code imports feed main.css; match main.css's ui @source lines to them",
	);
	const unscannedRoots = SOURCE_ROOTS.filter(
		(root) => !files.some((file) => file.startsWith(root)),
	);
	assert.deepEqual(
		unscannedRoots,
		[],
		"every portfolio source root is scanned",
	);
});
