import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import it from "node:test";
import {
	documentMarkdown,
	recipeBundle,
	recipeDocument,
} from "./recipe-export.mjs";

const { recipes } = JSON.parse(
	readFileSync(new URL("./recipes.json", import.meta.url), "utf8"),
);
const BROTH = /broth/iu;
const SAFE_POULTRY_METRIC = /74°C \(165°F\)/u;
const EXTRA_BATCHES = /extra pan or basket batches/u;
const UNTESTED = /not been kitchen-tested/u;
const GRAMS = /g$/u;
const TWO_SERVINGS = /two servings/u;
const CHILLED = /chilled/u;
const HOT_FOOD_SAFETY = /poultry|thermometer/u;
const REHEAT = /reheat/u;
it("assistant/print document preserves safe pressure liquid, recalculated macros and separate chosen family servings", () => {
	const r = recipes.find((recipe) => recipe.key === "salsa_chicken");
	const d = recipeDocument(r, {
		servings: 2,
		units: "metric",
		familyDiners: 1,
		familyChoice: { [r.id]: r.familyOptions[0].id },
	});
	assert.equal(
		d.ingredients.find((i) => BROTH.test(i.name)).quantity,
		"375 mL minimum (measure by volume)",
	);
	assert(Math.abs(d.nutrition.kcal - r.nutrition.kcal - 6.5625) < 1e-9);
	assert.equal(d.familyDiners, 1);
	assert(d.familyIngredient);
	assert.equal(d.steps.length, r.steps.length);
	assert.match(
		documentMarkdown(recipeDocument(r, { servings: 2, units: "metric" })),
		SAFE_POULTRY_METRIC,
	);
	assert(d.sources.every((s) => s.url.startsWith("https://")));
});
it("exports keep family choices, food states, allergies, limits and tiny spoon measures", () => {
	const r = recipes.find((recipe) => recipe.key === "turkey");
	const o = r.familyOptions.find((option) => option.id === "pita_one");
	const d = recipeDocument(r, {
		servings: 8,
		units: "metric",
		familyDiners: 3,
		familyChoice: { [r.id]: o.id },
	});
	assert.equal(d.familyIngredient.choiceId, o.id);
	assert.equal(d.familyIngredient.quantity, "180 g");
	assert(d.allergens.includes("wheat"));
	assert(d.ingredients.every((i) => typeof i.state === "string"));
	assert.match(d.capacity, EXTRA_BATCHES);
	assert.match(d.disclaimer, UNTESTED);
	assert.match(
		d.ingredients.find((i) => i.name === "Olive oil").quantity,
		GRAMS,
	);
	const noFamily = recipeDocument(r, { familyDiners: 0 });
	assert.equal(noFamily.familyIngredient, null);
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
});

it("new keto smoothies scale ingredients and keep cold preparation in exports", () => {
	for (const [id, netCarbs] of [
		["strawberry-hemp-smoothie", 8.282],
		["cucumber-spinach-lime-smoothie", 6.8546],
	]) {
		const recipe = recipes.find((r) => r.id === id);
		assert(recipe);
		assert.equal(recipe.type, "smoothie");
		assert.equal(recipe.group, "keto");
		assert.equal(recipe.nutrition.net_carbs_g, netCarbs);
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
			assert.equal(document.nutritionHeading, "Nutrition per 8 oz glass");
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
