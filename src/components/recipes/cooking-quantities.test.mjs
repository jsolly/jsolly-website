import assert from "node:assert/strict";
import { it } from "vitest";
import { cookingText } from "./cooking-quantities.mjs";
import { ingredientWithContext } from "./recipe-data.server.mjs";

const recipe = {
	id: "cooking-example",
	ingredients: [
		{ id: "food", amount: 680, unit: "g", scale: "linear" },
		{ id: "fixed", amount: 2, unit: "g", scale: "fixed" },
		{
			id: "seasoning",
			amount: 1,
			unit: "packet",
			weightRef: "fajita-packet",
			scale: "linear",
		},
	].map(ingredientWithContext),
};
const BAD_REFERENCE = /Unknown cooking quantity: cooking-example\/missing/u;
const BAD_TEMPLATE = /Invalid cooking quantity: cooking-example/u;

it("identified cooking allocations follow serving scaling and selected units", () => {
	assert.equal(
		cookingText(recipe, "Use {{quantity:food:0.5}}.", {
			servings: 2,
			units: "grams",
		}),
		"Use 170 g / 6 oz.",
	);
	assert.equal(
		cookingText(recipe, "Use {{quantity:food:0.5}}.", {
			servings: 2,
			units: "us",
		}),
		"Use 170 g / 6 oz.",
	);
	assert.equal(
		cookingText(recipe, "Use {{quantity:fixed}}.", {
			servings: 8,
			units: "metric",
		}),
		"Use 2 g / 0.07 oz.",
	);
	assert.equal(
		cookingText(recipe, "Season with {{portion:seasoning:tsp:1}}.", {
			servings: 2,
			units: "us",
		}),
		"Season with ½ tsp / 2 g / 0.05 oz.",
	);
	assert.equal(
		cookingText(recipe, "Season with {{portion:seasoning:tsp:1}}.", {
			servings: 2,
			units: "grams",
		}),
		"Season with ½ tsp / 2 g / 0.05 oz.",
	);
});

it("individual cooking portions keep their size while ingredient and nutrition prose remains literal", () => {
	assert.equal(
		cookingText(recipe, "Form {{mass:100}} patties.", {
			servings: 8,
			units: "us",
		}),
		"Form 100 g / 3.53 oz patties.",
	);
	assert.equal(
		cookingText(recipe, "Form {{mass:100}} patties.", {
			servings: 2,
			units: "grams",
		}),
		"Form 100 g / 3.53 oz patties.",
	);
	assert.equal(
		cookingText(recipe, "9 g protein per 100 g; buy a 32-ounce carton.", {
			units: "us",
		}),
		"9 g protein per 100 g; buy a 32-ounce carton.",
	);
});

it("missing and malformed cooking quantity references fail before rendering", () => {
	assert.throws(
		() => cookingText(recipe, "{{quantity:missing}}"),
		BAD_REFERENCE,
	);
	assert.throws(
		() => cookingText(recipe, "{{quantity:food:bad}}"),
		BAD_TEMPLATE,
	);
});
