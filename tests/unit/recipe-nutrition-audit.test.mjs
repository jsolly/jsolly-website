import assert from "node:assert/strict";
import { it } from "vitest";
import { archivedNutrition } from "../../src/components/recipes/archived-recipes.test-data.mjs";
import nutrition from "../../src/components/recipes/nutrition-data.json" with {
	type: "json",
};
import recipes from "../../src/components/recipes/recipe-data.server.mjs";
import {
	documentMarkdown,
	recipeDocument,
} from "../../src/components/recipes/recipe-export.mjs";
import { nutritionPortionLabel } from "../../src/components/recipes/recipe-logic.mjs";
import {
	auditNutrition,
	energyAudit,
	ingredientFatAudit,
} from "../../src/components/recipes/tools/audit-nutrition.mjs";

const FAT_GRAMS = /fat: [\d.]+ g/u;

it("every recipe has traceable fat and reviewed calorie agreement for every supported portion", () => {
	const audit = auditNutrition();
	assert.equal(audit.recipeCount, 140);
	assert.equal(
		audit.ingredientCount,
		recipes.recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0),
	);
	for (const entry of audit.entries) {
		assert.ok(entry.sourceUrls.length > 0, entry.recipeId);
		for (const portion of entry.servings) {
			assert.ok(portion.nutrition.fat_g >= 0, entry.recipeId);
			assert.equal(portion.fat.issue, null, entry.recipeId);
			assert.equal(
				portion.energy.issue,
				null,
				`${entry.recipeId}/${portion.servings}: ${portion.energy.issue}`,
			);
		}
	}
	// Preserve the independent branded-fat regression on the retired source model.
	const gnocchi = archivedNutrition.recipes[
		"sheet-pan-gnocchi-white-beans-and-broccoli"
	].find((row) => row.food === "gnocchi");
	assert.equal(gnocchi.nutrients.fat, 0);
	assert.equal(gnocchi.nutrientSources.fat, gnocchi.macroSource);
});

it("energy audit flags missing values and substantial discrepancies but retains specific-food energy", () => {
	assert.ok(
		energyAudit({
			kcal: 200,
			protein_g: 20,
			carbs_g: 10,
			fat_g: 20,
			fiber_g: 2,
		}).issue,
	);
	assert.ok(
		energyAudit({
			kcal: 200,
			protein_g: 20,
			carbs_g: 10,
			fat_g: null,
			fiber_g: 2,
		}).issue,
	);
	assert.equal(
		energyAudit({
			kcal: 195,
			protein_g: 20,
			carbs_g: 10,
			fat_g: 10,
			fiber_g: 2,
		}).issue,
		null,
	);
});

it("exports identify prepared-batch fractions and preserve complete ingredient provenance", () => {
	const recipe = recipes.recipes.find(
		(item) => item.id === "source-grilled-salmon-kabobs-with-greek-marinade",
	);
	const document = recipeDocument(recipe, { servings: 6 });
	assert.equal(
		document.nutritionPortionLabel,
		"per serving (1/6 of prepared batch)",
	);
	assert.equal(document.nutritionModel.energyCorrection, undefined);
	assert.match(documentMarkdown(document), FAT_GRAMS);
	for (const item of recipes.recipes.filter(
		(entry) => entry.sourceRecipe?.preCompleteIngredientNutritionEstimate,
	)) {
		for (const key of ["kcal", "protein_g", "carbs_g", "fiber_g"]) {
			const expected =
				nutrition.recipes[item.id].reduce(
					(sum, row) => sum + (row.macros[key] * row.grams) / 100,
					0,
				) / 4;
			assert.ok(
				Math.abs(item.nutrition[key] - expected) < 1e-8,
				`${item.id}/${key}`,
			);
		}
		assert.deepEqual(
			item.sourceRecipe.nutritionEstimate.publisherBaselineFields,
			[],
		);
	}
	const smoothie = recipes.recipes.find((item) => item.type === "smoothie");
	assert.equal(
		nutritionPortionLabel(smoothie, 8),
		"per estimated 8 fl oz (237 mL) glass",
	);
	assert.equal(
		nutritionPortionLabel(recipe, 99),
		"per serving (1/4 of prepared batch)",
	);
});

it("fat audit rejects a total below one oil ingredient even when calories could be forced to match", () => {
	const recipe = recipes.recipes.find(
		(item) => item.id === "source-grilled-salmon-kabobs-with-greek-marinade",
	);
	const audit = ingredientFatAudit(recipe, 4, 12.453);
	assert.ok(audit.largestIngredientFatGrams > 13);
	assert.ok(audit.ingredientFatGrams > 29);
	assert.ok(audit.issue);
});

it("only documented erythritol is excluded from net carbohydrates and energy comparisons", () => {
	const recipe = recipes.recipes.find(
		(item) => item.id === "source-sesame-chicken-keto-stir-fry",
	);
	assert.equal(recipe.nutrition.erythritol_g, 6);
	assert.ok(
		Math.abs(
			recipe.nutrition.net_carbs_g -
				(recipe.nutrition.carbs_g - recipe.nutrition.fiber_g - 6),
		) < 1e-8,
	);
	assert.equal(
		energyAudit({
			kcal: 0,
			protein_g: 0,
			carbs_g: 8,
			fiber_g: 0,
			fat_g: 0,
			erythritol_g: 8,
		}).differenceKcal,
		0,
	);
});
