import assert from "node:assert/strict";
import it from "node:test";
import { dailyNutrition, nutrientAmount } from "./nutrition.mjs";
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
						recipe.key === "salsa_chicken" ||
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
