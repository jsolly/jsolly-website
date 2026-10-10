import assert from "node:assert/strict";
import it from "node:test";
import {
	dailyNutrition,
	nutrientAmount,
	recordedOmega3,
} from "./nutrition.mjs";
import data from "./nutrition-data.json" with { type: "json" };
import { ingredientAmount } from "./recipe-logic.mjs";
import recipes from "./recipes.json" with { type: "json" };

it("Daily Values use edible weights, include salt, and scale minimum broth per serving", () => {
	const chicken = recipes.recipes.find((r) => r.key === "smoky_chicken");
	const sodium = dailyNutrition(chicken, 4, ingredientAmount).find(
		(n) => n.key === "sodium",
	);
	const salt = data.recipes[chicken.id].find((r) => r.food === "salt");
	assert.ok(sodium.amount >= (salt.nutrients.sodium * salt.grams) / 400);
	assert.equal(sodium.percent, Math.round((sodium.amount / 2300) * 100));
	const b12 = dailyNutrition(chicken, 4, ingredientAmount).find(
		(n) => n.key === "vitamin_b12",
	);
	assert.ok(b12.amount >= 9 / 4);
	const salsa = recipes.recipes.find((r) => r.key === "salsa_chicken");
	assert.ok(
		dailyNutrition(salsa, 2, ingredientAmount).find((n) => n.key === "sodium")
			.amount >
			dailyNutrition(salsa, 4, ingredientAmount).find((n) => n.key === "sodium")
				.amount,
	);
	for (const recipe of recipes.recipes) {
		const base = dailyNutrition(recipe, 4, ingredientAmount);
		for (const n of [2, 6, 8]) {
			const values = dailyNutrition(recipe, n, ingredientAmount);
			for (const [i, { amount: baseAmount }] of base.entries()) {
				const { amount } = values[i];
				// An unobserved nutrient stays unobserved; an observed one stays finite.
				assert.equal(amount === null, baseAmount === null);
				assert.ok(baseAmount === null || Number.isFinite(amount));
				assert.ok(
					baseAmount === null ||
						recipe.ingredients.some((ingredient) =>
							["minimum", "whole-batch"].includes(ingredient.scale),
						) ||
						Math.abs(amount - baseAmount) < 1e-8,
				);
			}
		}
	}
});
it("small nutrient amounts stay visible and missing observations stay missing", () => {
	assert.equal(nutrientAmount(0.03), "<0.1");
	assert.equal(nutrientAmount(null), "—");
	assert.equal(nutrientAmount(0), "0");
});

it("missing ingredient observations cannot become partial daily totals", () => {
	const recipe = recipes.recipes.find((r) => r.key === "smoky_chicken");
	assert.equal(
		dailyNutrition(recipe, 4, ingredientAmount).find(
			(n) => n.key === "pantothenic_acid",
		).amount,
		null,
	);
});

// Nutrition rows name USDA foods, which often differ from ingredient ids
// (fine_salt -> salt), and those rows scale linearly. Only a minimum-scale
// ingredient needs a row under its own id, or its floor never reaches the totals.
it("every minimum-scale ingredient has a nutrition row under its own id", () => {
	const minimum = recipes.recipes.flatMap((recipe) =>
		recipe.ingredients
			.filter((ingredient) => ingredient.scale === "minimum")
			.map((ingredient) => ({ recipe, ingredient })),
	);
	assert.ok(minimum.length > 0, "the library has minimum-scale ingredients");
	const unmatched = minimum
		.filter(
			({ recipe, ingredient }) =>
				!data.recipes[recipe.id].some((row) => row.food === ingredient.id),
		)
		.map(({ recipe, ingredient }) => `${recipe.id}/${ingredient.id}`);
	assert.deepEqual(unmatched, []);
});

it("whole-batch nutrient totals follow actual rounded ingredient quantities", () => {
	const recipe = recipes.recipes.find(
		(r) => r.id === "source-perfect-roast-chicken",
	);
	const base = dailyNutrition(recipe, 4, ingredientAmount);
	const omega = recordedOmega3(recipe, 4, ingredientAmount);
	for (const [servings, ratio] of [
		[2, 2],
		[4, 1],
		[6, 4 / 3],
		[8, 1],
	]) {
		const actual = dailyNutrition(recipe, servings, ingredientAmount);
		for (const [index, nutrient] of base.entries()) {
			assert.equal(actual[index].amount === null, nutrient.amount === null);
			assert.ok(
				nutrient.amount === null ||
					Math.abs(actual[index].amount - nutrient.amount * ratio) < 1e-8,
			);
		}
		assert.ok(
			Math.abs(
				recordedOmega3(recipe, servings, ingredientAmount) - omega * ratio,
			) < 1e-8,
		);
	}
});
