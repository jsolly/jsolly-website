// Regenerates the assistant downloads, public/recipes/data/recipe-library.json
// and recipe-library.md, from src/components/recipes/recipes.json. Biome and
// markdownlint skip public/recipes/data, so the committed bytes are exactly
// what this writes.
//
//   node scripts/recipes/sync-assistant-data.mjs          write both files
//   node scripts/recipes/sync-assistant-data.mjs --check  regenerate in memory
//                                                          and fail on drift
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	documentMarkdown,
	recipeBundle,
} from "../../src/components/recipes/recipe-export.mjs";
import { BASE_SERVINGS } from "../../src/components/recipes/recipe-logic.mjs";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};

const OUT_DIR = fileURLToPath(
	new URL("../../public/recipes/data/", import.meta.url),
);
const SETTINGS = { servings: BASE_SERVINGS, units: "us", familyDiners: 0 };

// File name -> content for every generated download.
export function generate(recipes = data.recipes) {
	const bundle = recipeBundle(recipes, SETTINGS);
	const intro = `# Easy Meals recipe library\n\n${recipes.length} complete four-serving recipes. Keto bases are shown without family starch; separate measured per-person options are included below each shared recipe. Small seasoning amounts use spoon measures. Recipes are newly designed and not kitchen-tested.\n\n`;
	return new Map([
		["recipe-library.json", `${JSON.stringify(bundle, null, 2)}\n`],
		[
			"recipe-library.md",
			intro +
				bundle.recipes
					.map((document) => documentMarkdown(document, 2))
					.join("\n---\n\n"),
		],
	]);
}

async function readCurrent(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

// The generated file names that are missing from dir or differ from what
// recipes.json generates.
export async function drift(dir = OUT_DIR) {
	const files = generate();
	const names = [...files.keys()];
	const current = await Promise.all(
		names.map((name) => readCurrent(join(dir, name))),
	);
	return names.filter((name, index) => current[index] !== files.get(name));
}

async function main(args) {
	if (!args.includes("--check")) {
		await mkdir(OUT_DIR, { recursive: true });
		await Promise.all(
			[...generate()].map(([name, content]) =>
				writeFile(join(OUT_DIR, name), content),
			),
		);
		console.log("✓ Wrote public/recipes/data/recipe-library.{json,md}.");
		return 0;
	}
	const drifted = await drift();
	if (drifted.length === 0) {
		console.log("✓ public/recipes/data matches recipes.json.");
		return 0;
	}
	for (const name of drifted) {
		console.error(
			`✗ public/recipes/data/${name} is missing or differs from what recipes.json generates.`,
		);
	}
	console.error("Run npm run recipes:sync and commit the result.");
	return 1;
}

// Compare real paths: import.meta.url is the realpath, argv[1] may be a symlink.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exitCode = await main(process.argv.slice(2));
}
