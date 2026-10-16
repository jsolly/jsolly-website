// Maintenance migration: complete eight formerly mixed publisher/ingredient models.
// Explicit profile choices are reviewed; this script never searches or fetches.

import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { reconcileMacros } from "./reconcile-nutrition.mjs";
import { observation } from "./usda-observation.mjs";

const ROOT = new URL("../../", import.meta.url);
const SWEETENER = "https://www.lakanto.com/products/brown-sugar-replacement";
const SWEETENER_LABEL =
	// biome-ignore lint/security/noSecrets: public manufacturer label image URL.
	"https://www.lakanto.com/cdn/shop/files/RP-246-4_1lbBrownErythritolRender_Shadow_TransparentBackground_Back.png?v=1776120527";
export function completeMacroModels(data, recipes, ranch) {
	if (ranch.fdcId !== 2248025 || ranch.dataType !== "Branded")
		throw new Error("Expected reviewed dry ranch proxy FDC 2248025");
	const affected = recipes.recipes.filter((recipe) =>
		recipe.sourceRecipe?.nutritionEstimate?.publisherBaselineFields?.includes(
			"kcal",
		),
	);
	for (const recipe of affected) {
		const rows = data.recipes[recipe.id];
		for (const row of rows.filter((item) =>
			Object.values(item.macros).some((amount) => amount === null),
		)) {
			const originalSource = row.originalProductSource ?? row.source;
			row.originalProductSource = originalSource;
			if (originalSource.includes("ghughessauce")) {
				row.macros = {
					kcal: (20 / 30) * 100,
					protein_g: 0,
					carbs_g: (2 / 30) * 100,
					fiber_g: 0,
				};
				row.description =
					"G Hughes honey mustard manufacturer label: 20 kcal, 1.5 g fat, 2 g carbohydrate, 0 g protein/fiber per 30 g; rounded label observations.";
			} else if (originalSource.includes("hiddenvalley")) {
				row.source = "https://fdc.nal.usda.gov/food-details/2248025/nutrients";
				row.reviewedDataType = "Branded";
				row.description =
					"USDA Our Family dry ranch dressing mix proxy for Hidden Valley dry seasoning; brands differ; rounded label observations.";
				row.macros = Object.fromEntries(
					Object.entries({
						kcal: 1008,
						protein_g: 1003,
						carbs_g: 1005,
						fiber_g: 1079,
					}).map(([key, id]) => [
						key,
						observation(ranch, id, key === "kcal" ? "kcal" : "g"),
					]),
				);
				row.nutrients.fat = observation(ranch, 1004, "g");
				row.nutrientSources = undefined;
				row.fatReview = {
					reviewedOn: "2026-10-15",
					source: row.source,
					basis: row.description,
				};
			} else if (
				originalSource.includes("swervesweet") ||
				row.description.toLowerCase().includes("monkfruit")
			) {
				row.source = SWEETENER;
				row.macros = {
					kcal: 0,
					protein_g: 0,
					carbs_g: 100,
					fiber_g: 0,
					erythritol_g: 100,
				};
				row.nutrients.fat = 0;
				row.description =
					"Lakanto Brown erythritol/monkfruit label proxy: per 8 g, 8 g total carbohydrate and 8 g erythritol, 0 g fat/protein and 0 kcal. Original source Swerve/unspecified brown monkfruit identity retained separately. Actual Swerve erythritol/allulose blend differs; no allulose mass is inferred. Trace glycerin and label rounding remain limitations.";
				row.nutrientSources = { ...row.nutrientSources, fat: SWEETENER };
				row.fatReview = {
					reviewedOn: "2026-10-15",
					source: SWEETENER,
					labelImage: SWEETENER_LABEL,
					basis: row.description,
				};
				row.carbExclusion = {
					nutrient: "erythritol_g",
					gramsPer100g: 100,
					source: SWEETENER,
					labelImage: SWEETENER_LABEL,
					basis:
						"Only documented erythritol is deducted from net carbohydrates; allulose and other sugar alcohols are not assumed.",
				};
			} else
				throw new Error(
					`Unreviewed incomplete profile: ${recipe.id}/${row.ingredientId}`,
				);
			row.macroSource = row.source;
			row.assumedMacroFields = [];
		}
		recipe.sourceRecipe.preCompleteIngredientNutritionEstimate ??=
			structuredClone(recipe.sourceRecipe.nutritionEstimate);
		const publisherFields = reconcileMacros(recipe, rows, recipes.baseServings);
		if (publisherFields.length)
			throw new Error(`Incomplete model: ${recipe.id}`);
		recipe.sourceRecipe.nutritionEstimate.publisherBaselineFields = [];
		recipe.sourceRecipe.nutritionEstimate.assumptions = rows.map(
			(row) =>
				`${recipe.ingredients.find((ingredient) => ingredient.id === row.ingredientId).name}: ${row.description ?? row.food}.`,
		);
		recipe.sourceRecipe.nutritionBasis =
			"Complete ingredient-based estimates using measured edible weights and reviewed USDA/manufacturer profiles. Brand proxies and rounded-label limitations are recorded in the ingredient assumptions. Original publisher nutrition is preserved separately.";
		recipe.nutritionEnergyCorrection = undefined;
	}
	data.publisherFatBaselines = undefined;
	return affected.map((recipe) => recipe.id);
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	if (process.argv.length !== 4 || process.argv[2] !== "--ranch")
		throw new Error(
			"Usage: node scripts/recipes/complete-macro-models.mjs --ranch /absolute/public-USDA-food.json",
		);
	const dataPath = new URL("src/components/recipes/nutrition-data.json", ROOT);
	const recipePath = new URL("src/components/recipes/recipes.json", ROOT);
	const data = JSON.parse(await readFile(dataPath, "utf8"));
	const recipes = JSON.parse(await readFile(recipePath, "utf8"));
	const ranch = JSON.parse(await readFile(process.argv[3], "utf8"));
	console.log(
		JSON.stringify({ completed: completeMacroModels(data, recipes, ranch) }),
	);
	for (const recipe of recipes.recipes) recipe.group = undefined;
	await writeFile(dataPath, `${JSON.stringify(data, null, "\t")}\n`);
	await writeFile(recipePath, `${JSON.stringify(recipes, null, "\t")}\n`);
}
