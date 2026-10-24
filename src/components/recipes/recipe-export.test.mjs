import assert from "node:assert/strict";
import { it } from "vitest";
import nutritionData from "./nutrition-data.json" with { type: "json" };
import data from "./recipe-data.server.mjs";
import {
	documentMarkdown,
	recipeBundle,
	recipeDocument,
} from "./recipe-export.mjs";

const { recipes } = data;
const BROTH = /broth/iu;
const SAFE_POULTRY_METRIC = /74°C \(165°F\)/u;
const EXTRA_BATCHES = /extra pan or basket batches/u;
const UNTESTED = /not been kitchen-tested/u;
const MILLILITERS = /mL$/u;
const TWO_SERVINGS = /two servings/u;
const CHILLED = /chilled/u;
const HOT_FOOD_SAFETY = /poultry|thermometer/u;
const REHEAT = /reheat/u;
it("assistant/print document preserves safe pressure liquid, recalculated macros and separate chosen optional sides", () => {
	const r = recipes.find((recipe) => recipe.key === "salsa_chicken");
	const d = recipeDocument(r, {
		servings: 2,
		units: "metric",
		familyDiners: 1,
		familyChoice: { [r.id]: r.familyOptions[0].id },
	});
	assert.equal(
		d.ingredients.find((i) => BROTH.test(i.name)).quantity,
		"375 mL",
	);
	assert.ok(
		d.cookingFlow.prep.some((step) => step.includes("at least 375 mL")),
	);
	assert(
		Math.abs(
			d.nutrition.kcal -
				r.nutrition.kcal -
				(((375 * 240) / 236.5882365) * 7) / 400,
		) < 1e-9,
	);
	assert.equal(d.sideDiners, 1);
	assert.ok(
		d.cookingFlow.prep.some((step) => step.includes("Heat ready-cooked rice.")),
	);
	assert(d.sideIngredient);
	assert.equal(d.steps.length, r.steps.length);
	assert.equal(d.sharedTable, r.sharedTable);
	assert.ok(
		documentMarkdown(d).includes(`## For a shared table\n\n${r.sharedTable}`),
	);
	assert.match(
		documentMarkdown(recipeDocument(r, { servings: 2, units: "metric" })),
		SAFE_POULTRY_METRIC,
	);
	assert(d.sources.every((s) => s.url.startsWith("https://")));
	const before = structuredClone(r);
	const option = r.familyOptions[0];
	const row = nutritionData.familyOptions[r.id].find(
		(item) => item.ingredientId === option.id,
	);
	const fat = (row.nutrients.fat * row.grams) / 100;
	const expected = { ...option.nutrition, fat_g: fat };
	for (const servings of [2, 4, 6, 8]) {
		const baseOnly = recipeDocument(r, { servings });
		for (const diners of [1, servings]) {
			const bundle = recipeBundle([r], {
				servings,
				familyDiners: diners,
				familyChoice: { [r.id]: option.id },
			});
			assert.equal(bundle.schemaVersion, 2);
			const document = JSON.parse(JSON.stringify(bundle)).recipes[0];
			assert.deepEqual(document.sideNutritionPerDiner, expected);
			assert.deepEqual(document.nutrition, baseOnly.nutrition);
			assert.equal(document.sideDiners, diners);
			assert.equal(document.sideIngredient.choiceId, option.id);
			assert.ok(
				documentMarkdown(document).includes(
					`Selected optional side only, per diner: Calories: ${option.nutrition.kcal.toFixed(0)} kcal; protein: ${option.nutrition.protein_g.toFixed(1)} g; fat: ${fat.toFixed(1)} g`,
				),
			);
		}
		for (const choice of [undefined, "", "stale"]) {
			const none = recipeDocument(r, {
				servings,
				familyDiners: servings,
				familyChoice: { [r.id]: choice },
			});
			assert.equal(none.sideNutritionPerDiner, null);
			assert.equal(none.sideIngredient, null);
			assert.equal(none.sideDiners, 0);
			assert.deepEqual(none.nutrition, baseOnly.nutrition);
			assert.ok(
				!documentMarkdown(none).includes(
					"Selected optional side only, per diner:",
				),
			);
		}
	}
	const disabled = recipeDocument(r, {
		familyDiners: 0,
		familyChoice: { [r.id]: option.id },
	});
	assert.equal(disabled.sideNutritionPerDiner, null);
	assert.equal(disabled.sideIngredient, null);
	assert.deepEqual(r, before);
});
it("exports keep optional side choices, food states, allergies, limits and tiny spoon measures", () => {
	const r = recipes.find((recipe) => recipe.key === "turkey");
	const o = r.familyOptions.find((option) => option.id === "pita_one");
	const d = recipeDocument(r, {
		servings: 8,
		units: "metric",
		familyDiners: 3,
		familyChoice: { [r.id]: o.id },
	});
	assert.equal(d.sideIngredient.choiceId, o.id);
	assert.equal(d.sideIngredient.quantity, "180 g");
	assert(d.allergens.includes("wheat"));
	assert(d.ingredients.every((i) => typeof i.state === "string"));
	assert.match(d.capacity, EXTRA_BATCHES);
	assert.match(d.disclaimer, UNTESTED);
	assert.match(
		d.ingredients.find((i) => i.name === "Olive oil").quantity,
		MILLILITERS,
	);
	const noFamily = recipeDocument(r, { familyDiners: 0 });
	assert.equal(noFamily.sideIngredient, null);
	assert(!noFamily.allergens.includes("wheat"));
	const d2 = recipeDocument(
		recipes.find((recipe) => recipe.key === "salmon"),
		{ servings: 2, units: "metric" },
	);
	assert.equal(
		d2.ingredients.find((i) => i.name === "Lemon zest").quantity,
		"1 g",
	);
	const bundle = JSON.parse(
		JSON.stringify(
			recipeBundle(recipes, { servings: 4, units: "us", familyDiners: 0 }),
		),
	);
	assert.equal(bundle.schemaVersion, 2);
	assert.equal(bundle.recipes.length, recipes.length);
	assert.equal(
		new Set(bundle.recipes.map((document) => document.recipeId)).size,
		recipes.length,
	);
	assert(
		bundle.recipes.every(
			(document) =>
				document.sources.length &&
				document.steps.length &&
				document.ingredients.length &&
				document.image,
		),
	);
	for (const [id, instruction] of [
		[
			"lemon-chicken-potatoes-and-green-beans",
			"Roast separately on a lined tray",
		],
		["source-grilled-bruschetta-chicken", "Simmer separately for 5–8 minutes"],
	]) {
		const meal = recipes.find((recipe) => recipe.id === id);
		const selected = recipeDocument(meal, {
			servings: 4,
			familyDiners: 2,
			familyChoice: { [id]: meal.familyOptions[0].id },
		});
		assert.equal(selected.sideDiners, 2);
		assert.ok(
			selected.cookingFlow.prep.some((step) => step.includes(instruction)),
		);
		assert.ok(
			selected.cookingFlow.prep.every(
				(step) => !step.includes("Warm the optional side per package"),
			),
		);
		assert.deepEqual(selected.nutrition, recipeDocument(meal).nutrition);
	}
});

it("new keto smoothies scale ingredients and keep cold preparation in exports", () => {
	for (const [id, netCarbs] of [
		["strawberry-hemp-smoothie", 8.282],
		["cucumber-spinach-lime-smoothie", 6.8546],
	]) {
		const recipe = recipes.find((r) => r.id === id);
		assert(recipe);
		assert.equal(recipe.type, "smoothie");
		assert.equal(recipeDocument(recipe).dietaryClassification, "keto");
		assert.ok(Math.abs(recipe.nutrition.net_carbs_g - netCarbs) < 1e-9);
		for (const servings of [2, 4, 6, 8]) {
			const document = recipeDocument(recipe, { servings, units: "metric" });
			assert.equal(
				document.ingredients.find((i) => i.name === "Plain lowfat Greek yogurt")
					.quantity,
				`${100 * servings} g`,
			);
			assert.ok(
				Math.abs(
					document.nutrition.net_carbs_g -
						(netCarbs * 4 * 236.5882365) / recipe.estimatedYieldMl,
				) < 1e-9,
			);
			assert.equal(
				document.nutritionHeading,
				"Nutrition per 8 fl oz (237 mL) glass",
			);
			assert.match(document.capacity, TWO_SERVINGS);
			assert.match(document.safety, CHILLED);
			assert.doesNotMatch(document.safety, HOT_FOOD_SAFETY);
			assert.doesNotMatch(document.leftovers, REHEAT);
			assert.equal(
				document.cookingFlow.rows.flat().filter((c) => c.kind === "ingredient")
					.length,
				recipe.ingredients.length,
			);
		}
	}
});
