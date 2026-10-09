import assert from "node:assert/strict";
import it from "node:test";
import { matchesRecipe, nutrientFilters } from "./nutrient-filters.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";
import {
	displayNutrition,
	familyNutrition,
	formatIngredient,
	formatNutrition,
	ingredientAmount,
	totalTimeLabel,
} from "./recipe-logic.mjs";
import data from "./recipes.json" with { type: "json" };

const MISSING_NUTRITION = /Not provided/u;
const MISSING_PREP = /Preparation time not provided/u;

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
	assert.equal(adapted.length, 125);
	assert.equal(new Set(data.recipes.map((r) => r.id)).size, 146);
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

it("unknown source nutrition remains unreported and cannot qualify for keto or nutrient filters", () => {
	const unverified = data.recipes.filter((r) => r.group === "unverified");
	assert.equal(unverified.length, 72);
	for (const recipe of unverified) {
		assert.equal(
			matchesRecipe(recipe, 4, { carb: ["keto"] }),
			false,
			recipe.id,
		);
		assert.deepEqual(
			nutrientFilters(recipe, 4),
			{ immune: false, iron: false, omega: false },
			recipe.id,
		);
		const nutrition = displayNutrition(recipe);
		for (const [key] of Object.entries(recipe.nutrition).filter(
			([, value]) => value === null,
		)) {
			assert.equal(nutrition[key], null, recipe.id + key);
			assert.equal(familyNutrition(recipe, "", 8)[key], null, recipe.id + key);
		}
		assert.match(documentMarkdown(recipeDocument(recipe)), MISSING_NUTRITION);
	}
});

it("unknown quantities are distinct from explicitly to-taste seasoning", () => {
	assert.ok(Number.isNaN(ingredientAmount({ amount: null }, 4)));
	assert.ok(Number.isNaN(ingredientAmount({ amount: undefined }, 4)));
	assert.equal(
		formatIngredient({ amount: null, unit: "g" }, 4),
		"Not specified",
	);
	assert.equal(formatIngredient({ amount: 0, unit: "g" }, 4), "to taste");
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
	assert.equal(totalTimeLabel({ totalMin: 25, totalMax: 30 }), "25–30 min");
	assert.equal(
		totalTimeLabel({ totalMin: 25, totalMax: 25 }, 8),
		"25+ min / base batch",
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
	for (const key of ["proteinType", "group"]) {
		for (const value of new Set(imported.map((recipe) => recipe[key]))) {
			const options =
				key === "proteinType" ? { protein: [value] } : { carb: [value] };
			assert.deepEqual(
				imported
					.filter((recipe) => matchesRecipe(recipe, 4, options))
					.map((recipe) => recipe.id),
				imported
					.filter((recipe) => recipe[key] === value)
					.map((recipe) => recipe.id),
			);
		}
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
