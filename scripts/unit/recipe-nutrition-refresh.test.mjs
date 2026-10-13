import assert from "node:assert/strict";
import { test as it } from "node:test";
import { refreshModels } from "../recipes/refresh-nutrition.mjs";

const source = "https://fdc.nal.usda.gov/food-details/123/nutrients";
const row = {
	food: "ingredient-1",
	source,
	grams: 400,
	nutrients: { iron: 1, fat: 2, vitamin_b12: null, vitamin_d: null },
	macros: { kcal: 10, protein_g: 1, carbs_g: 2, fiber_g: 0 },
	assumedMacroFields: ["fiber_g"],
};
const model = {
	nutrients: [
		{ key: "iron", usdaId: 1089, unit: "mg" },
		{ key: "fat", usdaId: 1004, unit: "g" },
		{ key: "vitamin_b12", usdaId: 1178, unit: "mcg" },
		{ key: "vitamin_d", usdaId: 1114, unit: "mcg" },
	],
	recipes: { one: [row] },
};
const recipes = {
	baseServings: 4,
	recipes: [
		{
			id: "one",
			nutrition: {
				kcal: 10,
				protein_g: 9,
				carbs_g: 2,
				fiber_g: 0,
				net_carbs_g: 2,
			},
			sourceRecipe: { nutritionEstimate: { estimatedMacroFields: ["kcal"] } },
		},
	],
};
const food = {
	fdcId: 123,
	dataType: "SR Legacy",
	foodNutrients: [
		{ nutrient: { id: 1089, unitName: "mg" }, amount: 3 },
		{ nutrient: { id: 1178, unitName: "µg" }, amount: 0.4 },
		{ nutrient: { id: 1087, unitName: "mg" }, amount: 50 },
		{ nutrient: { id: 1008, unitName: "kcal" }, amount: 20 },
		{ nutrient: { id: 1079, unitName: "g" }, amount: 4 },
	],
};
it("USDA refresh preserves supported publisher macros, assumed fields, and unobserved nutrient omissions", () => {
	const inputs = structuredClone(recipes);
	inputs.recipes[0].nutrition.carbs_g = 12;
	inputs.recipes[0].sourceRecipe.nutritionEstimate.estimatedMacroFields = [
		"kcal",
		"fiber_g",
		"net_carbs_g",
	];
	const secondFood = structuredClone(food);
	secondFood.fdcId = 456;
	secondFood.foodNutrients.find((entry) => entry.nutrient.id === 1008).amount =
		40;
	secondFood.foodNutrients.find((entry) => entry.nutrient.id === 1079).amount =
		8;
	const result = refreshModels(
		{
			...model,
			recipes: {
				one: [
					{ ...row, grams: 150 },
					{
						...structuredClone(row),
						source: "https://fdc.nal.usda.gov/food-details/456/nutrients",
						grams: 250,
						assumedMacroFields: [],
					},
				],
			},
		},
		inputs,
		new Map([
			[123, food],
			[456, secondFood],
		]),
		"2026-10-13",
	);
	assert.deepEqual(result.nutrition.recipes.one[0].nutrients, {
		iron: 3,
		vitamin_b12: 0.4,
		vitamin_d: null,
	});
	assert.equal(result.nutrition.recipes.one[0].nutrients.calcium, undefined);
	assert.equal(result.nutrition.recipes.one[0].macros.fiber_g, 0);
	// (150 g × 20 kcal/100 g + 250 g × 40 kcal/100 g) / four servings.
	assert.equal(result.recipes.recipes[0].nutrition.kcal, 32.5);
	assert.equal(result.recipes.recipes[0].nutrition.fiber_g, 5);
	assert.equal(result.recipes.recipes[0].nutrition.net_carbs_g, 7);
	assert.equal(result.recipes.recipes[0].nutrition.protein_g, 9);
	assert.equal(row.nutrients.iron, 1);
});
it("USDA refresh retains brand, composite and hybrid yeast profiles", () => {
	const hybrid = { ...row, food: "yeast" };
	const brand = { ...row, source: "https://example.com/label" };
	const result = refreshModels(
		{ ...model, recipes: { one: [hybrid, brand] } },
		{ ...recipes, recipes: [] },
		new Map(),
		"2026-10-13",
	);
	assert.deepEqual(result.nutrition.recipes.one, [hybrid, brand]);
	assert.equal(result.receipt.skippedRows.length, 2);
});
it("USDA refresh rejects unexpected food types, wrong units and incomplete estimated macro totals", () => {
	assert.throws(
		() =>
			refreshModels(
				model,
				recipes,
				new Map([[123, { ...food, dataType: "Branded" }]]),
				"today",
			),
		{ message: "Missing reviewed SR Legacy/FNDDS record 123" },
	);
	assert.throws(
		() =>
			refreshModels(
				model,
				recipes,
				new Map([
					[
						123,
						{
							...food,
							foodNutrients: [
								{ nutrient: { id: 1089, unitName: "g" }, amount: 1 },
							],
						},
					],
				]),
				"today",
			),
		{ message: "Invalid nutrient 1089 in FDC 123" },
	);
	assert.throws(
		() =>
			refreshModels(
				model,
				recipes,
				new Map([[123, { ...food, foodNutrients: [] }]]),
				"today",
			),
		{ message: "Missing kcal observation for one" },
	);
});
