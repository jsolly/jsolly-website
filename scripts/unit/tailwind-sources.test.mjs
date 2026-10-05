import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STYLESHEET = resolve(ROOT, "src/styles/main.css");
const SOURCE_ROOTS = [
	"src/components/",
	"src/layouts/",
	"src/pages/",
	"src/lib/",
];

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
	const unscannedRoots = SOURCE_ROOTS.filter(
		(root) => !files.some((file) => file.startsWith(root)),
	);
	assert.deepEqual(
		unscannedRoots,
		[],
		"every portfolio source root is scanned",
	);
});
