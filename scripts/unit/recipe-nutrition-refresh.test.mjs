import assert from "node:assert/strict";
import { it } from "vitest";
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

it("USDA refresh retains independently sourced label macros on a USDA micronutrient proxy", () => {
	const label = {
		...structuredClone(row),
		macroSource: "https://example.com/reviewed-label",
	};
	const result = refreshModels(
		{ ...model, recipes: { one: [label] } },
		{ ...recipes, recipes: [] },
		new Map([[123, food]]),
		"today",
	);
	assert.deepEqual(result.nutrition.recipes.one[0].macros, row.macros);
	assert.equal(result.nutrition.recipes.one[0].nutrients.iron, 3);
});

it("USDA refresh recomputes measured household macros and preserves publisher correction baselines", () => {
	const measured = structuredClone(recipes);
	measured.recipes[0].measurementNutritionBaseline = structuredClone(
		measured.recipes[0].nutrition,
	);
	measured.recipes[0].familyOptions = [
		{
			id: "bread",
			nutrition: {
				kcal: 8,
				protein_g: 0.8,
				carbs_g: 1.6,
				fiber_g: 0,
				net_carbs_g: 1.6,
			},
		},
	];
	const observed = structuredClone(food);
	observed.foodNutrients.push(
		{ nutrient: { id: 1003, unitName: "g" }, amount: 2 },
		{ nutrient: { id: 1005, unitName: "g" }, amount: 3 },
	);
	const measuredRow = {
		...structuredClone(row),
		measurementBaseline: { grams: 400, macros: structuredClone(row.macros) },
	};
	const result = refreshModels(
		{
			...model,
			recipes: { one: [measuredRow] },
			familyOptions: {
				one: [{ ...structuredClone(row), ingredientId: "bread", grams: 80 }],
			},
		},
		measured,
		new Map([[123, observed]]),
		"today",
	);
	assert.equal(result.recipes.recipes[0].nutrition.kcal, 20);
	assert.equal(result.recipes.recipes[0].nutrition.protein_g, 2);
	assert.equal(result.recipes.recipes[0].nutrition.net_carbs_g, 3);
	assert.equal(result.recipes.recipes[0].familyOptions[0].nutrition.kcal, 16);
	assert.equal(
		result.recipes.recipes[0].familyOptions[0].nutrition.protein_g,
		1.6,
	);
	assert.equal(result.nutrition.familyOptions.one[0].nutrients.iron, 3);
	assert.deepEqual(
		result.recipes.recipes[0].measurementNutritionBaseline,
		measured.recipes[0].measurementNutritionBaseline,
	);
});

it("USDA refresh preserves a reviewed brand fat observation on a generic micronutrient proxy", () => {
	const branded = {
		...structuredClone(row),
		nutrientSources: { fat: "https://example.com/brand-label" },
	};
	const result = refreshModels(
		{ ...model, recipes: { one: [branded] } },
		{ ...recipes, recipes: [] },
		new Map([[123, food]]),
		"2026-10-15",
	);
	assert.equal(result.nutrition.recipes.one[0].nutrients.fat, 2);
	assert.equal(result.nutrition.recipes.one[0].nutrients.iron, 3);
});

it("USDA refresh accepts an explicitly reviewed branded proxy and preserves documented erythritol", () => {
	const measuredRecipe = structuredClone(recipes.recipes[0]);
	measuredRecipe.measurementNutritionBaseline = { ...measuredRecipe.nutrition };
	measuredRecipe.familyOptions = [];
	const brandedRow = {
		...structuredClone(row),
		reviewedDataType: "Branded",
		macros: { ...row.macros, erythritol_g: 1 },
		measurementBaseline: { grams: row.grams, macros: { ...row.macros } },
	};
	const brandedFood = structuredClone(food);
	brandedFood.dataType = "Branded";
	brandedFood.foodNutrients.push(
		{ nutrient: { id: 1003, unitName: "g" }, amount: 2 },
		{ nutrient: { id: 1005, unitName: "g" }, amount: 3 },
	);
	const result = refreshModels(
		{ ...model, recipes: { one: [brandedRow] } },
		{ ...recipes, recipes: [measuredRecipe] },
		new Map([[123, brandedFood]]),
		"2026-10-15",
	);
	assert.equal(result.recipes.recipes[0].nutrition.kcal, 20);
	assert.equal(result.recipes.recipes[0].nutrition.erythritol_g, 1);
	assert.equal(result.recipes.recipes[0].nutrition.net_carbs_g, 2);
});
