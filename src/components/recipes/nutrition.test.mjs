import assert from "node:assert/strict";
import { it } from "vitest";
import {
	dailyNutrition,
	macroNutrition,
	nutrientAmount,
	recordedOmega3,
} from "./nutrition.mjs";
import data from "./nutrition-data.json" with { type: "json" };
import recipes from "./recipe-data.server.mjs";
import {
	ingredientAmount,
	sideNutrition,
	smoothiePortionNutrition,
} from "./recipe-logic.mjs";

// Edible four-portion batch contribution per diner. These expected ratios come
// from the cooking rules, independently of ingredientAmount and nutrient code.
const PER_DINER = {
	2: { linear: 1 / 4, fixed: 1 / 2, minimum: 1 / 2, "whole-batch": 1 / 2 },
	4: { linear: 1 / 4, fixed: 1 / 4, minimum: 1 / 4, "whole-batch": 1 / 4 },
	6: { linear: 1 / 4, fixed: 1 / 6, minimum: 1 / 4, "whole-batch": 1 / 3 },
	8: { linear: 1 / 4, fixed: 1 / 8, minimum: 1 / 4, "whole-batch": 1 / 4 },
};
const LINK_ERROR = /Invalid nutrition ingredient link/u;
const close = (actual, expected, label) =>
	// biome-ignore lint/suspicious/noMisplacedAssertion: shared numeric assertion called only from tests.
	assert.ok(
		expected === null ? actual === null : Math.abs(actual - expected) < 1e-8,
		`${label}: ${actual} != ${expected}`,
	);

it("every nutrient contribution explicitly links to its measured cooking ingredient and edible mass", () => {
	for (const recipe of recipes.recipes) {
		const rows = data.recipes[recipe.id];
		for (const ingredient of recipe.ingredients)
			assert.ok(
				rows.some((row) => row.ingredientId === ingredient.id),
				`${recipe.id}/${ingredient.id}`,
			);
		for (const row of rows) {
			const ingredient = recipe.ingredients.find(
				(item) => item.id === row.ingredientId,
			);
			assert.ok(ingredient, `${recipe.id}/${row.ingredientId}`);
			assert.ok(ingredient.amount > 0);
			assert.ok(row.grams > 0);
			assert.ok(
				row.measurementReconciliation.edibleFraction > 0 &&
					row.measurementReconciliation.edibleFraction <= 1,
			);
			close(
				row.grams,
				row.measurementReconciliation.cookingGrams *
					row.measurementReconciliation.edibleFraction,
				recipe.id,
			);
		}
	}
});

it("daily nutrients and recorded omega-3 follow actual fixed minimum whole-batch and linear food across every serving count", () => {
	for (const recipe of recipes.recipes) {
		const rows = data.recipes[recipe.id];
		const glassFactor =
			recipe.type === "smoothie"
				? (4 * 8 * 29.5735295625) / recipe.estimatedYieldMl
				: 1;
		for (const count of [2, 4, 6, 8]) {
			const values = dailyNutrition(recipe, count, ingredientAmount);
			const ratio = (row) =>
				PER_DINER[count][
					recipe.ingredients.find((i) => i.id === row.ingredientId).scale ??
						"linear"
				];
			for (const nutrient of values) {
				const observed = rows.every((row) =>
					Number.isFinite(row.nutrients[nutrient.key]),
				);
				const expected = observed
					? rows.reduce(
							(sum, row) =>
								sum +
								((row.nutrients[nutrient.key] * row.grams) / 100) * ratio(row),
							0,
						) * glassFactor
					: null;
				close(
					nutrient.amount,
					expected,
					`${recipe.id}/${count}/${nutrient.key}`,
				);
				assert.equal(
					nutrient.percent,
					expected === null
						? null
						: Math.round((expected / nutrient.dailyValue) * 100),
				);
			}
			const omega =
				rows.reduce(
					(sum, row) =>
						sum +
						(((row.omega3RecordedGramsPer100g ?? 0) * row.grams) / 100) *
							ratio(row),
					0,
				) * glassFactor;
			close(
				recordedOmega3(recipe, count, ingredientAmount),
				omega,
				`${recipe.id}/${count}/omega3`,
			);
		}
	}
});

it("macros use observed nonlinear contributions and preserve the separate smoothie glass yield", () => {
	for (const recipe of recipes.recipes) {
		const rows = data.recipes[recipe.id];
		for (const count of [2, 4, 6, 8]) {
			const actual = macroNutrition(recipe, count, ingredientAmount);
			for (const key of ["kcal", "protein_g", "carbs_g", "fiber_g"]) {
				const contributions = rows.filter(
					(row) =>
						recipe.ingredients.find((i) => i.id === row.ingredientId).scale !==
						"linear",
				);
				const expected =
					recipe.nutrition[key] +
					contributions.reduce((sum, row) => {
						const scale =
							recipe.ingredients.find((i) => i.id === row.ingredientId).scale ??
							"linear";
						return (
							sum +
							((row.macros[key] * row.grams) / 100) *
								(PER_DINER[count][scale] - 1 / 4)
						);
					}, 0);
				close(actual[key], expected, `${recipe.id}/${count}/${key}`);
			}
			close(
				actual.net_carbs_g,
				Math.max(
					0,
					actual.carbs_g - actual.fiber_g - (actual.erythritol_g ?? 0),
				),
				`${recipe.id}/net carbs`,
			);
		}
		if (recipe.type === "smoothie")
			close(
				smoothiePortionNutrition(recipe).kcal,
				(recipe.nutrition.kcal * 4 * 8 * 29.5735295625) /
					recipe.estimatedYieldMl,
				recipe.id,
			);
	}
});

it("positive fixed pepper contributes less per serving as diners increase", () => {
	const recipe = recipes.recipes.find((r) => r.key === "smoky_chicken");
	const row = data.recipes[recipe.id].find(
		(r) => r.ingredientId === "black_pepper",
	);
	// USDA 170931: 251 kcal, 20 mg sodium and 0.152 g recorded ALA per 100 g.
	close(row.grams, 0.575, "quarter teaspoon ground pepper");
	assert.equal(row.macros.kcal, 251);
	assert.equal(row.nutrients.sodium, 20);
	assert.equal(row.omega3RecordedGramsPer100g, 0.152);
	const difference =
		macroNutrition(recipe, 2, ingredientAmount).kcal -
		macroNutrition(recipe, 8, ingredientAmount).kcal;
	close(
		difference,
		((251 * 0.575) / 100) * (1 / 2 - 1 / 8),
		"fixed pepper calories",
	);
	const omegaDifference =
		recordedOmega3(recipe, 2, ingredientAmount) -
		recordedOmega3(recipe, 8, ingredientAmount);
	close(
		omegaDifference,
		((0.152 * 0.575) / 100) * (1 / 2 - 1 / 8),
		"fixed pepper omega3",
	);
	const sodium = (count) =>
		dailyNutrition(recipe, count, ingredientAmount).find(
			(nutrient) => nutrient.key === "sodium",
		).amount;
	close(
		sodium(2) - sodium(8),
		((20 * 0.575) / 100) * (1 / 2 - 1 / 8),
		"fixed pepper sodium",
	);
});

it("bone-in pork nutrition retains 80 percent edible yield instead of counting bones", () => {
	const rows =
		data.recipes[
			"source-pan-seared-pork-chops-with-creamy-pan-gravy-and-garlicky-green-beans"
		];
	const pork = rows.find((row) => row.ingredientId === "ingredient-1");
	close(pork.grams, 32 * 28.349523125 * 0.8, "edible pork grams");
	close(
		pork.measurementReconciliation.edibleFraction,
		0.8,
		"pork edible fraction",
	);
});

it("side nutrition returns only one diner's canonical portion and measured fat", () => {
	for (const recipe of recipes.recipes)
		for (const option of recipe.familyOptions) {
			const before = structuredClone(recipe);
			const row = data.familyOptions[recipe.id].find(
				(item) => item.ingredientId === option.id,
			);
			const actual = sideNutrition(recipe, option.id);
			for (const key of ["kcal", "protein_g", "carbs_g", "fiber_g"])
				close(
					actual[key],
					(row.macros[key] * row.grams) / 100,
					`${recipe.id}/${option.id}/${key}`,
				);
			close(
				actual.fat_g,
				(row.nutrients.fat * row.grams) / 100,
				`${recipe.id}/${option.id}/fat`,
			);
			assert.deepEqual(recipe, before);
			assert.equal(sideNutrition(recipe, "missing"), null);
		}
});

it("small nutrient amounts stay visible and missing observations stay missing", () => {
	assert.equal(nutrientAmount(0.03), "<0.1");
	assert.equal(nutrientAmount(null), "—");
	assert.equal(nutrientAmount(0), "0");
});

it("broken explicit ingredient links fail rather than silently scaling a different food", () => {
	const recipe = structuredClone(recipes.recipes[0]);
	recipe.ingredients = [];
	assert.throws(() => dailyNutrition(recipe, 4, ingredientAmount), LINK_ERROR);
	assert.throws(() => recordedOmega3(recipe, 4, ingredientAmount), LINK_ERROR);
	assert.throws(() => macroNutrition(recipe, 4, ingredientAmount), LINK_ERROR);
});
