// Regenerates the assistant downloads, public/recipes/data/recipe-library.json
// and recipe-library.md, from src/components/recipes/recipes.json. Biome skips
// public/recipes/data, so the committed bytes are exactly what this writes.
//
//   node scripts/recipes/sync-assistant-data.mjs          write both files
//   node scripts/recipes/sync-assistant-data.mjs --check  regenerate in memory
//                                                          and fail on drift
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
	documentMarkdown,
	recipeBundle,
} from "../../src/components/recipes/recipe-export.mjs";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};

const OUT_DIR = new URL("../../public/recipes/data/", import.meta.url);
const SETTINGS = { servings: 4, units: "us", familyDiners: 0 };

function generate(recipes) {
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

async function readCurrent(url) {
	try {
		return await readFile(url, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

async function main() {
	const files = generate(data.recipes);
	if (!process.argv.includes("--check")) {
		await mkdir(OUT_DIR, { recursive: true });
		await Promise.all(
			[...files].map(([name, content]) =>
				writeFile(new URL(name, OUT_DIR), content),
			),
		);
		console.log("✓ Wrote public/recipes/data/recipe-library.{json,md}.");
		return 0;
	}
	const names = [...files.keys()];
	const current = await Promise.all(
		names.map((name) => readCurrent(new URL(name, OUT_DIR))),
	);
	const drifted = names.filter(
		(name, index) => current[index] !== files.get(name),
	);
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

process.exitCode = await main();
