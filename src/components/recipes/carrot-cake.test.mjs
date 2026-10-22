import assert from "node:assert/strict";
import { it } from "vitest";
import data from "./recipe-data.server.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";

it("carrot cake keeps complete pan batches, edible egg weights and cold frosting guidance", () => {
	const cake = data.recipes.find((recipe) => recipe.id === "carrot-cake");
	// Zona Cooks specifies one small egg and one 6-inch pan for four slices.
	// USDA's small egg observation is 38 g edible, excluding shell.
	for (const [servings, eggGrams] of [
		[2, 38],
		[4, 38],
		[6, 76],
		[8, 76],
	]) {
		const document = recipeDocument(cake, { servings, units: "grams" });
		assert.equal(
			document.ingredients.find((row) => row.name === "Egg").grams,
			eggGrams,
		);
		assert.equal(
			document.ingredients.find((row) => row.name === "Powdered sugar").grams,
			servings > 4 ? 120 : 60,
		);
		assert.ok(
			document.cookingFlow.prep.some((step) =>
				step.includes("never deepen one pan"),
			),
		);
		assert.ok(document.leftovers.includes("refrigerator"));
		assert.ok(!document.leftovers.includes("165"));
		assert.ok(document.safety.includes("Do not taste uncooked batter"));
		assert.ok(
			documentMarkdown(document).includes("https://zonacooks.com/carrot-cake/"),
		);
	}
});
