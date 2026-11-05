import assert from "node:assert/strict";
import { it } from "vitest";
import {
	isKetoSavedRecipe,
	requirePublishedRecipe,
	retirementMarkdown,
} from "./recipe-publication.mjs";
import { retiredRecipePath } from "./recipe-url.mjs";
import retired from "./retired-recipes.json" with { type: "json" };

const KETO_REQUIRED = /qualify as keto/u;
const SHARED_TABLE_REQUIRED = /shared-table/u;
const RETIRED = /retired/u;

const meal = (netCarbs) => ({
	id: "synthetic-meal",
	type: "meal",
	sharedTable: "Offer rice separately.",
	nutrition: { carbs_g: netCarbs + 2, fiber_g: 2 },
});

it("publication rejects non-keto, retired and missing shared-table recipes", () => {
	const recipe = meal(12.5);
	assert.equal(requirePublishedRecipe(recipe), recipe);
	assert.throws(() => requirePublishedRecipe(meal(12.5001)), KETO_REQUIRED);
	assert.throws(
		() => requirePublishedRecipe({ ...recipe, sharedTable: " " }),
		SHARED_TABLE_REQUIRED,
	);
	assert.throws(
		() => requirePublishedRecipe({ ...recipe, id: retired[0].id }),
		RETIRED,
	);
});

it("saved eligibility uses the saved meal or glass amount and excludes unknown formats", () => {
	assert.equal(isKetoSavedRecipe({ recipe: meal(12.5) }), true);
	assert.equal(isKetoSavedRecipe({ recipe: meal(12.6) }), false);
	assert.equal(
		isKetoSavedRecipe({ recipe: { ...meal(4), id: retired[0].id } }),
		false,
	);
	assert.equal(
		isKetoSavedRecipe({ recipe: { ...meal(4), sharedTable: undefined } }),
		true,
	);
	const smoothie = {
		...meal(20),
		type: "smoothie",
		estimatedYieldMl: 8 * 29.5735295625 * 8,
	};
	assert.equal(isKetoSavedRecipe({ recipe: smoothie }), true);
	assert.equal(
		isKetoSavedRecipe({
			recipe: { ...smoothie, estimatedYieldMl: 8 * 29.5735295625 * 4 },
		}),
		false,
	);
	for (const record of [
		null,
		{},
		{ recipe: {} },
		{ recipe: { type: "smoothie" } },
	])
		assert.equal(isKetoSavedRecipe(record), false);
});

it("every retired link has an explicit notice without an active recipe document", () => {
	assert.equal(retired.length, 8);
	assert.equal(new Set(retired.map(({ id }) => id)).size, retired.length);
	for (const recipe of retired) {
		assert.equal(retiredRecipePath(recipe.id), `/recipes/${recipe.id}/`);
		const markdown = retirementMarkdown(recipe);
		assert.ok(markdown.includes(recipe.title));
		assert.ok(markdown.includes("no longer in the keto collection"));
		assert.ok(
			markdown.includes(
				`/recipes/${recipe.type === "smoothie" ? "smoothies" : "meals"}/`,
			),
		);
		assert.ok(!markdown.includes("## Ingredients"));
	}
	for (const id of ["missing", "../carrot-cake", "CARROT-CAKE", undefined])
		assert.equal(retiredRecipePath(id), null);
});
