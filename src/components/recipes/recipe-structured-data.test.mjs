import assert from "node:assert/strict";
import { it } from "vitest";
import data from "./recipe-data.server.mjs";
import { recipeDocument } from "./recipe-export.mjs";
import { recipeStructuredData } from "./recipe-structured-data.mjs";

const site = new URL("https://www.jsolly.com/");
const duration = /^PT[0-9]+(?:\.[0-9]+)?M$/u;

it("every published recipe has its image, measured cooking instructions, ingredient quantities and matching nutrition portion", () => {
	for (const recipe of data.recipes) {
		const structured = recipeStructuredData(recipe, site);
		const document = recipeDocument(recipe);
		assert.equal(structured["@type"], "Recipe");
		assert.equal(structured.name, recipe.title);
		assert.equal(structured.image.url, new URL(recipe.image.src, site).href);
		assert.equal(structured.recipeIngredient.length, recipe.ingredients.length);
		assert.ok(
			structured.recipeIngredient.every((line, index) =>
				line.startsWith(`${document.ingredients[index].quantity} `),
			),
		);
		assert.deepEqual(
			structured.recipeInstructions.map((step) => step.text),
			[
				...document.cookingFlow.prep,
				...document.steps.map((step) => step.text),
			],
		);
		assert.equal(
			structured.nutrition.calories,
			`${document.nutrition.kcal.toFixed(0)} kcal`,
		);
		assert.equal(
			structured.nutrition.carbohydrateContent,
			`${document.nutrition.carbs_g.toFixed(1)} g`,
		);
		assert.equal(
			structured.publisher["@id"],
			"https://www.jsolly.com/#organization",
		);
		assert.ok(!("suitableForDiet" in structured));
		assert.ok(!("prepTime" in structured));
		assert.ok(!("cookTime" in structured));
		const expectedTime =
			Number.isFinite(recipe.totalMin) &&
			recipe.totalMin > 0 &&
			recipe.totalMin === recipe.totalMax
				? `PT${recipe.totalMin}M`
				: undefined;
		assert.equal(structured.totalTime, expectedTime);
		const expectedYield =
			recipe.type === "smoothie"
				? `${(recipe.estimatedYieldMl / (8 * 29.5735295625)).toFixed(1)} estimated 8 fl oz (237 mL) glasses`
				: "4 servings";
		assert.equal(structured.recipeYield, expectedYield);
		assert.equal(
			structured.nutrition.servingSize,
			recipe.type === "smoothie"
				? "1 estimated 8 fl oz (237 mL) glass"
				: "1 serving",
		);
	}
	assert.ok(
		data.recipes
			.map((recipe) => recipeStructuredData(recipe, site).totalTime)
			.filter(Boolean)
			.every((time) => duration.test(time)),
	);
});

it("publisher adaptations retain source URLs without inventing an author or missing duration", () => {
	const recipe = data.recipes.find(
		(item) => item.sourceRecipe && item.totalMax === null,
	);
	assert.ok(recipe);
	const structured = recipeStructuredData(recipe, site);
	assert.equal(
		structured.isBasedOn,
		recipe.sourceRecipe.resolvedUrl ?? recipe.sourceRecipe.url,
	);
	assert.deepEqual(
		structured.citation,
		recipe.sources.map((source) => source.url),
	);
	assert.ok(!("author" in structured));
	assert.ok(!("totalTime" in structured));
});
