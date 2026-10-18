import assert from "node:assert/strict";
import it from "node:test";
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

it("reviewed mass quantities retain their original measured food amount", () => {
	for (const recipe of data.recipes)
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
