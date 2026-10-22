import assert from "node:assert/strict";
import { it } from "vitest";
import { matchesRecipe } from "./nutrient-filters.mjs";
import nutritionData from "./nutrition-data.json" with { type: "json" };
import data from "./recipe-data.server.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";
import {
	dietaryClass,
	displayNutrition,
	formatIngredient,
	formatNutrition,
	ingredientAmount,
	totalTimeLabel,
} from "./recipe-logic.mjs";

const NUTRITION_ASSUMPTIONS = /Nutrition assumptions:/u;
const MISSING_PREP = /Preparation time not provided/u;
const BAD_MEASUREMENT = /amount must be finite and positive/u;

it("source metadata exports accept reactive proxies and retain resolved publisher links in Markdown", () => {
	const adapted = data.recipes.filter((recipe) => recipe.sourceRecipe);
	for (const recipe of adapted) {
		const sourceRecipe = new Proxy(recipe.sourceRecipe, {});
		const document = recipeDocument({ ...recipe, sourceRecipe });
		assert.deepEqual(document.sourceRecipe, recipe.sourceRecipe, recipe.id);
		const markdown = documentMarkdown(document);
		for (const source of recipe.sources) {
			assert.ok(markdown.includes(source.url), recipe.id);
		}
	}
	for (const recipe of adapted.filter(
		(candidate) => candidate.sourceRecipe.resolvedUrl,
	)) {
		assert.ok(
			documentMarkdown(recipeDocument(recipe)).includes(
				recipe.sourceRecipe.resolvedUrl,
			),
			recipe.id,
		);
	}
});

it("publisher adaptations retain their IDs, attribution and nutrition provenance in JSON downloads", () => {
	const adapted = data.recipes.filter((r) => r.sourceRecipe);
	assert.equal(adapted.length, 126);
	// The source gives 32 ounces of bone-in chops; model 80% edible weight, not pounds.
	const porkRows =
		nutritionData.recipes[
			"source-pan-seared-pork-chops-with-creamy-pan-gravy-and-garlicky-green-beans"
		];
	assert.ok(
		Math.abs(
			porkRows.find((row) => row.food === "ingredient-1").grams - 725.747792,
		) < 0.000001,
	);
	assert.equal(new Set(data.recipes.map((r) => r.id)).size, 147);
	for (const recipe of adapted) {
		const document = JSON.parse(JSON.stringify(recipeDocument(recipe)));
		assert.deepEqual(document.sourceRecipe, recipe.sourceRecipe, recipe.id);
		assert.deepEqual(document.sources, recipe.sources, recipe.id);
		assert.equal(
			document.nutritionNote,
			recipe.sourceRecipe.nutritionBasis,
			recipe.id,
		);
	}
});

it("every recipe has macros and publisher estimates retain ingredient evidence with base-derived dietary eligibility", () => {
	for (const recipe of data.recipes) {
		for (const value of Object.values(recipe.nutrition))
			assert.ok(Number.isFinite(value), recipe.id);
		assert.ok(
			Math.abs(
				recipe.nutrition.net_carbs_g -
					Math.max(
						0,
						recipe.nutrition.carbs_g -
							recipe.nutrition.fiber_g -
							(recipe.nutrition.erythritol_g ?? 0),
					),
			) < 0.000001,
			recipe.id,
		);
	}
	const adapted = data.recipes.filter((recipe) => recipe.sourceRecipe);
	assert.equal(adapted.length, 126);
	assert.equal(
		adapted.filter(
			(recipe) =>
				recipe.sourceRecipe.preMeasurementNutritionEstimate
					?.estimatedMacroFields?.length,
		).length,
		72,
	);
	for (const recipe of adapted) {
		const estimate = recipe.sourceRecipe.nutritionEstimate;
		const rows = nutritionData.recipes[recipe.id];
		assert.ok(rows.length > 0, recipe.id);
		assert.ok(estimate.assumptions.length > 0, recipe.id);
		assert.deepEqual(
			estimate.ingredientSnapshot,
			recipe.ingredients.map(({ id, name, amount, unit, state }) => ({
				id,
				name,
				amount,
				unit,
				state,
			})),
			recipe.id,
		);
		assert.match(
			documentMarkdown(recipeDocument(recipe)),
			NUTRITION_ASSUMPTIONS,
		);
		for (const row of rows) {
			const ingredient = recipe.ingredients.find(
				(candidate) => candidate.id === row.ingredientId,
			);
			assert.ok(ingredient, recipe.id);
			const { name, amount, unit, state } = ingredient;
			assert.deepEqual(
				row.ingredientSnapshot,
				{ name, amount, unit, state },
				recipe.id,
			);
			assert.ok(row.grams > 0, recipe.id);
			assert.ok(row.source.startsWith("https://"), recipe.id);
		}
		for (const key of estimate.estimatedMacroFields.filter(
			(field) =>
				field !== "net_carbs_g" &&
				!estimate.publisherBaselineFields?.includes(field),
		)) {
			const total =
				rows.reduce((sum, row) => {
					assert.ok(Number.isFinite(row.macros[key]), recipe.id + key);
					return sum + (row.macros[key] * row.grams) / 100;
				}, 0) / 4;
			assert.ok(
				Math.abs(total - recipe.nutrition[key]) < 0.000001,
				recipe.id + key,
			);
		}
	}
	for (const recipe of adapted)
		assert.equal(
			dietaryClass(recipe),
			displayNutrition(recipe).net_carbs_g <= 12.5 ? "keto" : "nonketo",
			recipe.id,
		);
});

it("every cooking ingredient is measured while missing source amounts remain provenance", () => {
	assert.ok(Number.isNaN(ingredientAmount({ amount: null }, 4)));
	assert.ok(Number.isNaN(ingredientAmount({ amount: undefined }, 4)));
	for (const amount of [null, undefined, 0])
		assert.throws(
			() => formatIngredient({ amount, unit: "g" }, 4),
			BAD_MEASUREMENT,
		);
	for (const recipe of data.recipes)
		for (const ingredient of [...recipe.ingredients, ...recipe.familyOptions])
			assert.ok(
				Number.isFinite(ingredient.amount) && ingredient.amount > 0,
				`${recipe.id}/${ingredient.id}`,
			);
	assert.equal(formatNutrition(null, "g"), "Not provided");
	assert.equal(formatNutrition(0, "g"), "0 g");
});

it("whole-batch recipes round up the ingredient quantity without silently dropping a bird", () => {
	const recipe = data.recipes.find((r) =>
		r.ingredients.some((i) => i.scale === "whole-batch"),
	);
	assert.ok(recipe);
	const bird = recipe.ingredients.find((i) => i.scale === "whole-batch");
	for (const [servings, batches] of [
		[2, 1],
		[4, 1],
		[6, 2],
		[8, 2],
	]) {
		assert.equal(ingredientAmount(bird, servings), bird.amount * batches);
	}
});

it("missing publisher times stay absent in exported cooking documents", () => {
	assert.equal(totalTimeLabel({ totalMin: 25, totalMax: 25 }), "25 min");
	assert.equal(totalTimeLabel({ totalMin: 25, totalMax: 30 }), "30 min");
	assert.equal(
		totalTimeLabel({ totalMin: 25, totalMax: 25 }, 8),
		"25 min / base batch",
	);
	const missing = data.recipes.filter(
		(r) =>
			r.activeMinutes === null || r.totalMin === null || r.totalMax === null,
	);
	assert.ok(missing.length > 0);
	for (const recipe of missing.filter(
		(candidate) => candidate.totalMin === null || candidate.totalMax === null,
	)) {
		const document = recipeDocument(recipe);
		assert.equal(document.totalTime, "Not provided");
	}
	for (const recipe of missing.filter(
		(candidate) => candidate.activeMinutes === null,
	)) {
		assert.match(documentMarkdown(recipeDocument(recipe)), MISSING_PREP);
	}
});

it("expanded protein, meal style and starch filters use the canonical recipe fields", () => {
	const imported = data.recipes.filter((recipe) => recipe.sourceRecipe);
	for (const value of new Set(imported.map((recipe) => recipe.proteinType))) {
		assert.deepEqual(
			imported
				.filter((recipe) => matchesRecipe(recipe, 4, { protein: [value] }))
				.map((recipe) => recipe.id),
			imported
				.filter((recipe) => recipe.proteinType === value)
				.map((recipe) => recipe.id),
		);
	}
	for (const value of ["keto", "nonketo"]) {
		assert.deepEqual(
			imported
				.filter((recipe) => matchesRecipe(recipe, 4, { carb: [value] }))
				.map((recipe) => recipe.id),
			imported
				.filter(
					(recipe) =>
						(displayNutrition(recipe).net_carbs_g <= 12.5
							? "keto"
							: "nonketo") === value,
				)
				.map((recipe) => recipe.id),
		);
	}
	for (const starch of new Set(imported.flatMap((recipe) => recipe.starches))) {
		assert.deepEqual(
			imported
				.filter((recipe) => matchesRecipe(recipe, 4, { starch: [starch] }))
				.map((recipe) => recipe.id),
			imported
				.filter((recipe) => recipe.starches.includes(starch))
				.map((recipe) => recipe.id),
		);
	}
});
