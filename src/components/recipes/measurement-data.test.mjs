import assert from "node:assert/strict";
import { it } from "vitest";
import { archivedRecipes } from "./archived-recipes.test-data.mjs";
import { ingredientGrams } from "./ingredient-units.mjs";
import weights from "./ingredient-weights.json" with { type: "json" };
import data from "./recipe-data.server.mjs";

const references = new Map(
	weights.references.map((reference) => [reference.id, reference]),
);
const MASS = new Set(["g", "oz", "lb"]);
const BUTTER = /\bbutter\b/iu;
const NUT_BUTTER = /peanut|almond|cashew/iu;
const BUTTER_FOOD = /^Butter,/u;
const REVIEWED_MASS_CHANGES = new Map([
	[
		"lemon-chicken-potatoes-and-green-beans/ingredient/olive_oil",
		{
			amount: 13.5,
			unit: "g",
			sourceId: "olive_oil",
			evidence: "Halve the original oil, herbs and zest",
		},
	],
	[
		"lemon-chicken-potatoes-and-green-beans/ingredient/lemon_zest",
		{
			amount: 1,
			unit: "g",
			sourceId: "lemon_zest",
			evidence: "Halve the original oil, herbs and zest",
		},
	],
	[
		"lemon-chicken-potatoes-and-green-beans/family/plain_roasted_potatoes",
		{
			amount: 567 / 4,
			unit: "g",
			sourceId: "baby_potatoes",
			evidence: "Move all potatoes to an explicitly selected per-diner side",
		},
	],
	[
		"source-low-carb-taco-casserole/ingredient/ingredient-6",
		{
			amount: 10,
			unit: "g",
			sourceId: "ingredient-6",
			evidence: "Taco seasoning: 1 oz to 10 g",
		},
	],
	[
		"source-creamy-tuscan-salmon-recipe/ingredient/ingredient-7",
		{ amount: 60, unit: "g", sourceId: "ingredient-7", evidence: "oz to 60 g" },
	],
]);

it("measurement migration preserves mass while later keto changes retain independently reviewed archive evidence", () => {
	// The measurement migration did not change measured food amounts. Later recipe
	// adaptations have a separate review and keep the complete original registries.
	for (const recipe of archivedRecipes)
		for (const ingredient of [...recipe.ingredients, ...recipe.familyOptions]) {
			const original = ingredient.measurementProvenance.original;
			if (!MASS.has(original.unit) || !(original.amount > 0)) continue;
			assert.equal(
				ingredient.amount,
				original.amount,
				`${recipe.id}/${ingredient.id}`,
			);
			assert.equal(
				ingredient.unit,
				original.unit,
				`${recipe.id}/${ingredient.id}`,
			);
		}
	const reviewed = new Set();
	for (const recipe of data.recipes)
		for (const [kind, ingredients] of [
			["ingredient", recipe.ingredients],
			["family", recipe.familyOptions],
		])
			for (const ingredient of ingredients) {
				const original = ingredient.measurementProvenance.original;
				if (!MASS.has(original.unit) || !(original.amount > 0)) continue;
				const identity = `${recipe.id}/${kind}/${ingredient.id}`;
				const change = REVIEWED_MASS_CHANGES.get(identity);
				assert.deepEqual(
					{ amount: ingredient.amount, unit: ingredient.unit },
					change
						? { amount: change.amount, unit: change.unit }
						: { amount: original.amount, unit: original.unit },
					identity,
				);
				if (!change) continue;
				reviewed.add(identity);
				const archive = archivedRecipes.find((item) => item.id === recipe.id);
				const source = archive.ingredients.find(
					(item) => item.id === change.sourceId,
				);
				assert.deepEqual(
					{ amount: original.amount, unit: original.unit },
					{
						amount: source.measurementProvenance.original.amount,
						unit: source.measurementProvenance.original.unit,
					},
					identity,
				);
				assert.equal(recipe.ketoAdaptation.reviewedOn, "2026-10-23", identity);
				assert.equal(
					recipe.ketoAdaptation.archive,
					"docs/recipes-archive/keto-2026-10-23/recipes.json",
					identity,
				);
				assert.deepEqual(
					recipe.ketoAdaptation.originalNutrition,
					archive.nutrition,
					identity,
				);
				assert.ok(
					recipe.ketoAdaptation.changes.some((note) =>
						note.includes(change.evidence),
					),
					identity,
				);
			}
	assert.deepEqual(
		[...reviewed].sort(),
		[...REVIEWED_MASS_CHANGES.keys()].sort(),
	);
});

it("salted and unsalted butter cooking portions use butter observations", () => {
	let reviewed = 0;
	for (const recipe of data.recipes)
		for (const ingredient of recipe.ingredients) {
			if (
				!BUTTER.test(ingredient.name) ||
				NUT_BUTTER.test(ingredient.name) ||
				MASS.has(ingredient.unit)
			)
				continue;
			reviewed++;
			assert.match(
				references.get(ingredient.weightRef).description,
				BUTTER_FOOD,
				`${recipe.id}/${ingredient.id}`,
			);
		}
	assert.ok(reviewed >= 12);
});

it("prepared vegetable substitutions retain measured edible targets instead of unspecified packets", () => {
	for (const [recipeId, ingredientId, grams] of [
		["source-chicken-burrito-bowls-with-cauliflower", "ingredient-4", 588],
		["source-beef-and-cauliflower-rice-burrito-bowl", "ingredient-4", 588],
		[
			"source-10-minute-pizza-zucchini-noodles-with-marinara-sauce-pepperoni",
			"ingredient-2",
			4 * 196,
		],
		[
			"source-sausage-taco-cauliflower-rice-skillet",
			"ingredient-7",
			16 * 28.349523125,
		],
		[
			"source-garlic-butter-steak-bites-with-lemon-zucchini-noodles",
			"ingredient-2",
			4 * 196,
		],
		[
			"source-lemon-garlic-butter-chicken-and-zucchini-noodles-skillet",
			"ingredient-2",
			4 * 196,
		],
		[
			"source-taco-chicken-tenders-with-lemon-garlic-butter-zucchini-noodles",
			"ingredient-2",
			4 * 196,
		],
	]) {
		const ingredient = data.recipes
			.find((recipe) => recipe.id === recipeId)
			.ingredients.find((row) => row.id === ingredientId);
		const choice = ingredient.alternatives[0];
		assert.equal(choice.unit, "g", recipeId);
		assert.equal(choice.amount, grams, recipeId);
		assert.equal(ingredientGrams(ingredient), grams, recipeId);
		assert.equal(choice.measurementProvenance.massBasis, "edible", recipeId);
		assert.ok(
			ingredient.measurementProvenance.original.state ||
				ingredient.measurementProvenance.original.note,
			recipeId,
		);
	}
	const freshCauliflower = data.recipes.find(
		(recipe) => recipe.id === "source-sausage-taco-cauliflower-rice-skillet",
	);
	for (const instructions of [
		JSON.stringify(freshCauliflower.flow),
		JSON.stringify(freshCauliflower.steps),
	]) {
		assert.ok(
			instructions.includes("Rice fresh florets, then steam until tender."),
		);
		assert.ok(
			instructions.includes(
				"For packaged rice, microwave according to the packet.",
			),
		);
	}
});

const RAW_QUANTITY =
	/(?:\b(?:\d+(?:[./]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter)|[¼½¾⅓⅔])\s*(?:[-–]\s*)?(?:(?:small|medium|large|size|sized|whole)\s+)*(?:g|grams?|oz|ounces?|lb|pounds?|cups?|tsp|teaspoons?|tbsp|tablespoons?|slices?|spears?|bunch(?:es)?|heads?|crowns?|cloves?|lemons?|limes?|breasts?|fillets?)\b/iu;
const MIGRATION_NARRATIVE =
	/\b(?:source|archived|restored version|conversion|cup equivalent|cup range|scaled edible weight|old to-taste|(?:small|medium|large) head)\b/iu;

it("cooking ingredient copy keeps source quantity echoes in provenance", () => {
	// A scaled row must not also prescribe a raw source count, volume or mass.
	// Composition criteria are concentration limits; they deliberately retain grams.
	function echoes(text) {
		return RAW_QUANTITY.test(
			text
				.replace(/\{\{(?:mass|quantity|portion):[^}]+\}\}/gu, "<quantity>")
				.replace(/(?:At least|Substitute at most) [^.]+\./gu, ""),
		);
	}
	let originalEchoes = 0;
	for (const recipe of data.recipes)
		for (const ingredient of [...recipe.ingredients, ...recipe.familyOptions]) {
			for (const field of ["name", "state", "note"]) {
				const text = ingredient[field] ?? "";
				assert.equal(
					echoes(text),
					false,
					`${recipe.id}/${ingredient.id}/${field}: ${text}`,
				);
				assert.equal(
					MIGRATION_NARRATIVE.test(text),
					false,
					`${recipe.id}/${ingredient.id}/${field}: ${text}`,
				);
				if (echoes(ingredient.measurementProvenance.original[field] ?? ""))
					originalEchoes++;
			}
		}
	assert.ok(
		originalEchoes > 25,
		"Original source quantities remain available in provenance",
	);
});
