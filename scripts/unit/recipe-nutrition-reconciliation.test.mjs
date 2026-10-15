import assert from "node:assert/strict";
import { test as it } from "node:test";
import {
	observedProfile,
	reconcileNutrition,
} from "../recipes/reconcile-nutrition.mjs";

const macros = { kcal: 200, protein_g: 20, carbs_g: 4, fiber_g: 1 };
const model = {
	nutrients: [],
	recipes: {
		meal: [{ food: "meat", grams: 80, macros, nutrients: { sodium: 50 } }],
	},
};
const recipes = {
	baseServings: 4,
	recipes: [
		{
			id: "meal",
			ingredients: [
				{
					id: "meat",
					name: "Bone-in meat",
					amount: 100,
					unit: "g",
					state: "raw",
					scale: "linear",
					measurementProvenance: { massBasis: "as-purchased" },
				},
				{
					id: "pepper",
					name: "Black pepper",
					amount: 2,
					unit: "g",
					state: "ground",
					scale: "fixed",
				},
			],
			familyOptions: [],
			nutrition: {
				kcal: 40,
				protein_g: 4,
				carbs_g: 0.8,
				fiber_g: 0.2,
				net_carbs_g: 0.6,
			},
		},
	],
};
const dependencies = {
	gramsForIngredient: (i) => i.amount,
	macroProfile: () => macros,
	profileForIngredient: () => ({
		macros: { kcal: 250, protein_g: 10, carbs_g: 60, fiber_g: 25 },
		nutrients: { sodium: 20 },
	}),
};

it("reconciliation keeps bone refuse out, adds measured defaults and is repeatable", () => {
	const before = JSON.stringify({ model, recipes });
	const result = reconcileNutrition(model, recipes, dependencies);
	const rows = result.nutrition.recipes.meal;
	assert.deepEqual(
		rows.map((row) => [row.ingredientId, row.grams]),
		[
			["meat", 80],
			["pepper", 2],
		],
	);
	assert.equal(rows[0].measurementReconciliation.edibleFraction, 0.8);
	assert.deepEqual(result.recipes.recipes[0].nutrition, {
		kcal: 41.25,
		protein_g: 4.05,
		carbs_g: 1.1,
		fiber_g: 0.325,
		net_carbs_g: 0.7750000000000001,
	});
	assert.deepEqual(
		reconcileNutrition(result.nutrition, result.recipes, dependencies),
		result,
	);
	assert.equal(JSON.stringify({ model, recipes }), before);
	const larger = structuredClone(result.recipes);
	larger.recipes[0].ingredients[0].amount = 200;
	assert.equal(
		reconcileNutrition(result.nutrition, larger, dependencies).nutrition.recipes
			.meal[0].grams,
		160,
	);
});

it("reconciliation preserves publisher claims while correcting observed contributions", () => {
	const input = structuredClone(model);
	input.recipes.meal[0].macros.kcal = null;
	const recipeInput = structuredClone(recipes);
	recipeInput.recipes[0].sourceRecipe = {
		sourceNutrition: { calories: "40 kcal" },
		nutritionEstimate: { estimatedMacroFields: [] },
	};
	const result = reconcileNutrition(input, recipeInput, dependencies);
	assert.equal(result.recipes.recipes[0].nutrition.kcal, 41.25);
	assert.deepEqual(result.recipes.recipes[0].sourceRecipe.sourceNutrition, {
		calories: "40 kcal",
	});
	assert.deepEqual(
		result.recipes.recipes[0].sourceRecipe.nutritionEstimate
			.publisherBaselineFields,
		["kcal"],
	);
	const changed = structuredClone(result.recipes);
	changed.recipes[0].ingredients[0].amount = 200;
	assert.throws(
		() => reconcileNutrition(result.nutrition, changed, dependencies),
		{ message: "Unobserved kcal changed mass: meal/meat" },
	);
});

it("unlinked nutrient contributions and absent profile decisions fail with ingredient context", () => {
	const bad = structuredClone(model);
	bad.recipes.meal[0].food = "orphan";
	assert.throws(() => reconcileNutrition(bad, recipes, dependencies), {
		message: "Unlinked nutrition row: meal/orphan",
	});
	assert.throws(
		() =>
			reconcileNutrition(model, recipes, {
				...dependencies,
				profileForIngredient: () => undefined,
			}),
		{
			message: "Missing reviewed nutrient profile: meal/pepper (Black pepper)",
		},
	);
});

it("archive profile extraction retains missing observations and counts only recorded ALA EPA DHA", () => {
	const row = observedProfile(
		{
			fdcId: 1,
			description: "Food",
			foodNutrients: [
				{ nutrient: { id: 1008, unitName: "kcal" }, amount: 20 },
				{ nutrient: { id: 1404, unitName: "g" }, amount: 0.1 },
				{ nutrient: { id: 1278, unitName: "g" }, amount: 0.2 },
				{ nutrient: { id: 1272, unitName: "g" }, amount: 0.3 },
				{ nutrient: { id: 1406, unitName: "g" }, amount: 9 },
			],
		},
		[{ key: "sodium", usdaId: 1093, unit: "mg" }],
	);
	assert.deepEqual(row.nutrients, {});
	assert.equal(row.macros.kcal, 20);
	assert.equal(row.macros.protein_g, null);
	assert.ok(Math.abs(row.omega3RecordedGramsPer100g - 0.6) < 1e-12);
});

it("family additions follow their own measured food mass per diner", () => {
	const input = structuredClone(recipes);
	input.recipes[0].familyOptions = [{ id: "rice", amount: 80, unit: "g" }];
	const result = reconcileNutrition(model, input, {
		...dependencies,
		familyProfile: () => ({
			macros: { kcal: 130, protein_g: 2.69, carbs_g: 28.17, fiber_g: 0.4 },
			nutrients: {},
		}),
	});
	assert.equal(result.recipes.recipes[0].familyOptions[0].nutrition.kcal, 104);
	assert.equal(result.nutrition.familyOptions.meal[0].ingredientId, "rice");
	assert.equal(result.nutrition.familyOptions.meal[0].grams, 80);
});

it("family reconciliation preserves missing protein and fiber instead of manufacturing zero totals", () => {
	const input = structuredClone(recipes);
	input.recipes[0].familyOptions = [{ id: "bread", amount: 50, unit: "g" }];
	const result = reconcileNutrition(model, input, {
		...dependencies,
		familyProfile: () => ({
			macros: { kcal: 200, protein_g: null, carbs_g: 30, fiber_g: null },
			nutrients: {},
		}),
	});
	assert.deepEqual(result.recipes.recipes[0].familyOptions[0].nutrition, {
		kcal: 100,
		protein_g: null,
		carbs_g: 15,
		fiber_g: null,
		net_carbs_g: null,
	});
	assert.equal(result.nutrition.familyOptions.meal[0].macros.fiber_g, null);
});

it("profile extraction rejects duplicate, wrong-unit and negative daily macro and omega observations", () => {
	const nutrients = [{ key: "sodium", usdaId: 1093, unit: "mg" }];
	for (const [id, unitName] of [
		[1093, "mg"],
		[1008, "kcal"],
		[1404, "g"],
	]) {
		const valid = { nutrient: { id, unitName }, amount: 1 };
		const food = {
			fdcId: 123,
			description: "Food",
			foodNutrients: [valid, structuredClone(valid)],
		};
		assert.throws(() => observedProfile(food, nutrients), {
			message: `Duplicate nutrient ${id} in FDC 123`,
		});
		food.foodNutrients = [
			{ nutrient: { id, unitName: "invalid-unit" }, amount: 1 },
		];
		assert.throws(() => observedProfile(food, nutrients), {
			message: `Invalid nutrient ${id} in FDC 123`,
		});
		food.foodNutrients = [{ nutrient: { id, unitName }, amount: -1 }];
		assert.throws(() => observedProfile(food, nutrients), {
			message: `Invalid nutrient ${id} in FDC 123`,
		});
	}
});

it("profile extraction distinguishes absent observations from recorded zero and normalizes microgram units", () => {
	const row = observedProfile(
		{
			fdcId: 123,
			description: "Food",
			foodNutrients: [
				{ nutrient: { id: 1008, unitName: "kcal" } },
				{ nutrient: { id: 1003, unitName: "g" }, amount: 0 },
				{ nutrient: { id: 1093, unitName: "mg" } },
				{ nutrient: { id: 1178, unitName: "µg" }, amount: 2 },
			],
		},
		[
			{ key: "sodium", usdaId: 1093, unit: "mg" },
			{ key: "vitamin_b12", usdaId: 1178, unit: "mcg" },
		],
	);
	assert.deepEqual(row.nutrients, { vitamin_b12: 2 });
	assert.deepEqual(row.macros, {
		kcal: null,
		protein_g: 0,
		carbs_g: null,
		fiber_g: null,
	});
	assert.equal(row.omega3RecordedGramsPer100g, 0);
});
