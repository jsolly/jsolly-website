import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { it, vi } from "vitest";
import { unitAudit } from "../../../scripts/recipes/audit-units.mjs";
import { archivedRecipes } from "./archived-recipes.test-data.mjs";
import {
	ingredientGrams,
	ingredientMeasure,
	unitPreference,
} from "./ingredient-units.mjs";
import weights from "./ingredient-weights.json" with { type: "json" };
import data from "./recipe-data.server.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";
import {
	formatIngredient,
	formatQuantity,
	ingredientAmount,
} from "./recipe-logic.mjs";
import { readRecipeURL, recipeHref } from "./recipe-url.mjs";
import { flowGrid, gridHtml } from "./trn-logic.mjs";
import {
	readRecipePreferences,
	writeRecipePreferences,
	writeSidePreference,
} from "./unit-preference.mjs";

const NO_OBSERVATION = /no fl oz observation/u;
const BAD_AMOUNT =
	/test-recipe\/test-ingredient: amount must be finite and positive/u;
const MISSING_REF = /missing weightRef/u;
const UNKNOWN_REF = /unknown weightRef/u;
const WHOLE_GRAMS = /^\d+ g$/u;
const BAD_DISPLAY =
	/unavailable|unspecified|to taste|NaN|Infinity|undefined|~|^0(?: |g)/u;
const ingredient = (amount, unit, extra = {}) => ({
	id: "test-ingredient",
	recipeId: "test-recipe",
	name: "Test ingredient",
	amount,
	unit,
	scale: "linear",
	...extra,
	weightReference: weights.references.find(
		(reference) => reference.id === extra.weightRef,
	),
	alternatives: extra.alternatives?.map((choice) => ({
		...choice,
		weightReference: weights.references.find(
			(reference) => reference.id === choice.weightRef,
		),
	})),
});

it("mass displays show whole grams and customary weight without changing exact quantities", () => {
	for (const units of ["grams", "metric", "us"]) {
		assert.equal(
			formatIngredient(ingredient(1, "oz"), 4, units),
			"28 g / 1 oz",
		);
		assert.equal(
			formatIngredient(ingredient(1, "lb"), 4, units),
			"454 g / 1 lb",
		);
		assert.equal(formatIngredient(ingredient(0.001, "g"), 2, units), "A pinch");
		assert.equal(
			formatIngredient(ingredient(1.49, "g"), 4, units),
			"1 g / 0.05 oz",
		);
	}
	assert.equal(ingredientGrams(ingredient(1, "oz")), 28.349523125);
	assert.equal(ingredientGrams(ingredient(0.001, "g"), 0.0005), 0.0005);
});

it("whole foods and small household measures remain useful at every supported batch size", () => {
	const recipe = data.recipes.find(
		(row) => row.id === "source-basic-keto-chaffle-recipe",
	);
	assert.equal(
		formatIngredient(recipe.ingredients[0], 2),
		"1 large egg / 50 g / 1.76 oz",
	);
	assert.equal(
		formatIngredient(recipe.ingredients[0], 4),
		"2 large eggs / 100 g / 3.53 oz",
	);
	assert.equal(
		formatIngredient(recipe.ingredients[0], 8),
		"4 large eggs / 200 g / 7.05 oz",
	);
	assert.equal(
		formatIngredient(recipe.ingredients[2], 2),
		"1 ⅓ tbsp / 8 g / 0.28 oz",
	);
	assert.equal(formatIngredient(recipe.ingredients[3], 2), "A pinch");
	const garlic = ingredient(9, "g", { weightRef: "usda-169230" });
	assert.equal(formatIngredient(garlic, 4), "about 3 cloves / 9 g / 0.32 oz");
	const cauliflower = ingredient(882, "g", { weightRef: "usda-169986" });
	assert.equal(
		formatIngredient(cauliflower, 4),
		"about 1 ½ heads / 882 g / 1.94 lb",
	);
	const lemon = ingredient(96, "g", { weightRef: "usda-167747" });
	assert.equal(
		formatIngredient(lemon, 4),
		"juice of about 2 lemons / 96 g / 93 mL",
	);
});

it("explicit portion identities ignore prose and distinguish sticks, slices, produce and sized cans", () => {
	const butter = ingredient(28.25, "g", {
		weightRef: "usda-173430",
		name: "Whipped alternative",
		note: "organic or conventional",
	});
	assert.equal(formatIngredient(butter, 4), "about ¼ stick / 28 g / 1 oz");
	assert.equal(
		formatIngredient(ingredient(14, "g", { weightRef: "cheese-slice" }), 4),
		"about ½ slice / 14 g / 0.49 oz",
	);
	assert.equal(
		formatIngredient(
			ingredient(150.5, "g", { weightRef: "usda-168409-large" }),
			4,
		),
		"about ½ large cucumber / 151 g / 5.31 oz",
	);
	assert.equal(
		formatIngredient(
			ingredient(205.5, "g", { weightRef: "tomato-can-content-411" }),
			4,
		),
		"about ½ of a 411 g can / 206 g / 7.25 oz",
	);
	assert.equal(
		formatIngredient(
			ingredient(100, "g", { name: "2 cucumbers or half a jar" }),
			4,
		),
		"100 g / 3.53 oz",
	);
	const ref = weights.references.find(
		(r) =>
			r.kind === "mass" && !r.volumeInterpolationUnit && !r.measures["fl oz"],
	);
	assert.throws(
		() => ingredientGrams(ingredient(1, "fl oz", { weightRef: ref.id })),
		NO_OBSERVATION,
	);
});

it("food-specific spoon observations and liquid densities retain dimensional differences", () => {
	assert.equal(
		ingredientGrams(ingredient(1, "tbsp", { weightRef: "usda-171325" })),
		9.7,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "tsp", { weightRef: "usda-171325" })),
		3.1,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "tbsp", { weightRef: "usda-170859" })),
		15,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "cup", { weightRef: "usda-170859" })),
		238,
	);
	assert.equal(
		formatIngredient(ingredient(1, "tbsp", { weightRef: "usda-171413" }), 4),
		"1 tbsp / 14 g / 15 mL",
	);
	assert.equal(
		formatIngredient(ingredient(1, "tsp", { weightRef: "usda-173468" }), 4),
		"1 tsp / 6 g / 0.21 oz",
	);
	assert.equal(
		formatIngredient(ingredient(1, "tsp", { weightRef: "morton-kosher" }), 4),
		"1 tsp / 5 g / 0.17 oz",
	);
});

it("missing quantities and unresolved references fail with ingredient identity before rendering", () => {
	for (const units of ["grams", "us", "metric"]) {
		for (const amount of [null, undefined, 0, -1, Infinity, NaN])
			assert.throws(
				() => formatIngredient(ingredient(amount, "g"), 4, units),
				BAD_AMOUNT,
			);
		for (const unit of ["cup", "ml", "count", "package", "can", "pinch", ""])
			assert.throws(
				() => formatIngredient(ingredient(1, unit), 4, units),
				MISSING_REF,
			);
		assert.throws(
			() =>
				formatIngredient(
					ingredient(1, "g", { weightRef: "unknown-reference" }),
					4,
					units,
				),
			UNKNOWN_REF,
		);
	}
});

it("pressure liquid minima and whole batches retain exact scaling before household display", () => {
	const all = data.recipes.flatMap((r) => r.ingredients);
	const liquid = all.find((i) => i.scale === "minimum" && i.unit === "ml");
	assert.equal(ingredientAmount(liquid, 2), liquid.amount);
	const display = ingredientMeasure(
		liquid,
		ingredientAmount(liquid, 2),
		"us",
		formatQuantity,
	);
	assert.ok(
		display.measurements.some((m) => m.quantity === `${liquid.amount} mL`),
	);
	assert.equal(
		ingredientGrams(liquid, ingredientAmount(liquid, 8)),
		2 * ingredientGrams(liquid),
	);
	const bird = all.find((i) => i.scale === "whole-batch");
	assert.equal(ingredientAmount(bird, 6), bird.amount * 2);
	assert.equal(
		ingredientGrams(bird, ingredientAmount(bird, 6)),
		2 * ingredientGrams(bird),
	);
});

it("liquid alternatives resolve their independent weights and preserve invariant choices", () => {
	const liquids = weights.references.filter(
		(ref) => ref.kind === "liquid" && ref.gramsPerMl > 0,
	);
	const [first, second] = liquids;
	const row = ingredient(first.gramsPerMl * 100, "g", {
		weightRef: first.id,
		alternatives: [
			{
				name: "Alternative liquid",
				amount: second.gramsPerMl * 200,
				unit: "g",
				weightRef: second.id,
			},
		],
	});
	const shown = ingredientMeasure(row, row.amount * 1.5, "us", formatQuantity);
	assert.ok(shown.measurements.some((m) => m.quantity === "150 mL"));
	assert.ok(
		shown.alternatives[0].measurements.some((m) => m.quantity === "300 mL"),
	);
	assert.equal(shown.alternatives[0].name, "Alternative liquid");
	assert.deepEqual(
		shown,
		ingredientMeasure(row, row.amount * 1.5, "grams", formatQuantity),
	);
	assert.ok(
		Math.abs(shown.alternatives[0].grams - second.gramsPerMl * 300) < 1e-9,
	);
});

it("all ingredients and selected sides share at most three invariant measurements through the serving matrix", () => {
	const before = JSON.stringify(data);
	for (const recipe of data.recipes)
		for (const servings of [2, 4, 6, 8]) {
			const document = recipeDocument(recipe, {
				servings,
				units: "us",
				familyDiners: servings,
			});
			const grid = flowGrid(recipe, { servings, units: "us" });
			for (const [index, row] of recipe.ingredients.entries()) {
				const amount = ingredientAmount(row, servings);
				const shown = ingredientMeasure(row, amount, "us", formatQuantity);
				assert.deepEqual(
					shown,
					ingredientMeasure(row, amount, "grams", formatQuantity),
				);
				assert.deepEqual(
					shown,
					ingredientMeasure(row, amount, "metric", formatQuantity),
				);
				assert.equal(shown.grams, ingredientGrams(row, amount));
				assert.equal(document.ingredients[index].quantity, shown.quantity);
				assert.ok(
					shown.measurements.length >= 1 && shown.measurements.length <= 3,
				);
				for (const m of shown.measurements) {
					assert.doesNotMatch(m.quantity, BAD_DISPLAY);
					assert.ok(
						m.status !== "mass" ||
							!m.quantity.endsWith(" g") ||
							WHOLE_GRAMS.test(m.quantity),
					);
				}
				for (const [choiceIndex, choice] of (
					row.alternatives || []
				).entries()) {
					const displayed = shown.alternatives[choiceIndex];
					assert.equal(displayed.name, choice.name);
					assert.ok(displayed.grams > 0);
					const leaves = grid.rows.filter(
						(leaf) => leaf.ingredient.ingredientId === row.id,
					);
					const allocated = leaves.map(
						(leaf) =>
							leaf.cells.find((cell) => cell.kind === "ingredient")
								.alternatives[choiceIndex],
					);
					assert.ok(
						Math.abs(
							allocated.reduce((sum, p) => sum + p.grams, 0) - displayed.grams,
						) < 1e-8,
					);
				}
			}
			for (const option of recipe.familyOptions)
				for (let diners = 1; diners <= servings; diners++) {
					const shown = ingredientMeasure(
						option,
						option.amount * diners,
						"us",
						formatQuantity,
					);
					assert.ok(
						Math.abs(shown.grams - ingredientGrams(option) * diners) < 1e-8,
					);
					assert.ok(shown.measurements.length <= 3);
				}
		}
	assert.equal(JSON.stringify(data), before);
});

it("lettuce-wrap alternatives show the same independent measurements in JSON, Markdown and flow HTML", () => {
	const recipe = data.recipes.find(
		(r) => r.id === "source-keto-asian-chicken-lettuce-wraps",
	);
	const masses = [249 / 4, 236.5882365 / 4, 29.4 * 2];
	for (const servings of [2, 4, 6, 8]) {
		const document = recipeDocument(recipe, { servings, units: "us" });
		const row = document.ingredients.find((i) => i.name === "chicken broth");
		const choices = [row, ...row.alternatives];
		for (const [index, choice] of choices.entries())
			assert.ok(Math.abs(choice.grams - (masses[index] * servings) / 4) < 1e-9);
		const markdown = documentMarkdown(document);
		const html = gridHtml(
			recipe.title,
			flowGrid(recipe, { servings, units: "metric" }),
		);
		const dom = new JSDOM(html);
		try {
			const cell = [
				...dom.window.document.querySelectorAll("th.trn-ingredient"),
			].find((c) => c.textContent.includes("chicken broth"));
			assert.deepEqual(
				[...cell.querySelectorAll("strong")].map((c) => c.textContent),
				choices.map((c) => c.quantity),
			);
			for (const choice of choices)
				assert.ok(markdown.includes(choice.quantity));
		} finally {
			dom.window.close();
		}
	}
});

it("the archive preserves original measurement identities while the current audit covers every published ingredient", () => {
	const audit = JSON.parse(unitAudit());
	assert.equal(audit.recipeCount, 140);
	assert.equal(archivedRecipes.length, 147);
	const migratedIdentities = [
		...new Set(
			archivedRecipes
				.filter((recipe) => recipe.id !== "carrot-cake")
				.flatMap((recipe) => [
					...recipe.ingredients.map(
						(item) =>
							`${recipe.id}/ingredient/${item.measurementProvenance.sourceIngredientId}`,
					),
					...recipe.familyOptions.map(
						(item) =>
							`${recipe.id}/family/${item.measurementProvenance.sourceIngredientId}`,
					),
				]),
		),
	].sort();
	assert.equal(migratedIdentities.length, 1680);
	assert.equal(
		createHash("sha256")
			.update(JSON.stringify(migratedIdentities))
			.digest("hex"),
		// biome-ignore lint/security/noSecrets: SHA256 of the pre-migration ingredient identities.
		"f670105d5e3f41d9ba467a7ef8c7a17db56307fee5efa41fecacba64aaf7b669",
	);
	assert.ok(audit.ingredientCount >= audit.sourceIdentityCount);
	assert.equal(
		audit.ingredientCount,
		data.recipes.reduce(
			(total, recipe) =>
				total + recipe.ingredients.length + recipe.familyOptions.length,
			0,
		),
	);
});

it("unit links override a saved preference and round-trip every valid mode", () => {
	const recipe = data.recipes[0];
	for (const units of ["grams", "us", "metric"]) {
		const settings = { units, servings: 6 };
		const parsed = readRecipeURL(
			new URL(recipeHref(recipe, settings), "https://www.jsolly.com"),
			[recipe],
			{ units: "metric" },
		);
		assert.equal(parsed.units, units);
		assert.equal(parsed.servings, 6);
	}
	assert.equal(unitPreference("imperial"), "us");
	assert.equal(unitPreference(["metric"]), "us");
	assert.equal(unitPreference("__proto__"), "us");
});
const SIDE_RECIPE = {
	id: "bowl",
	familyOptions: [{ id: "rice" }, { id: "pita" }],
};
it("individual-page unit preference updates retire keto switches and preserve every unrelated saved field", () => {
	const prior = {
		servings: 8,
		familyDiners: 2,
		filters: {
			ingredientChoice: ["hemp"],
			proteinChoice: ["fish"],
			mealKetoOnly: true,
			smoothieKetoOnly: true,
		},
		familyChoice: { otherRecipe: "rice" },
		appliancesOnHand: { Oven: 2 },
	};
	let saved = JSON.stringify(prior);
	const storage = {
		getItem: () => saved,
		setItem: (_key, value) => {
			saved = value;
		},
	};
	writeRecipePreferences(
		SIDE_RECIPE,
		{ ...prior, units: "grams" },
		() => storage,
	);
	assert.equal(
		readRecipePreferences(SIDE_RECIPE, () => storage).units,
		"grams",
	);
	assert.deepEqual(JSON.parse(saved), {
		...prior,
		units: "grams",
		filters: { ingredientChoice: ["hemp"], proteinChoice: ["fish"] },
	});
});
it("individual-page side preferences share the library's familyChoice record and keep other fields", () => {
	const prior = {
		units: "metric",
		familyChoice: { otherRecipe: "rice", bowl: "naan" },
	};
	let saved = JSON.stringify(prior);
	const storage = {
		getItem: () => saved,
		setItem: (_key, value) => {
			saved = value;
		},
	};
	const getStorage = () => storage;
	assert.deepEqual(
		readRecipePreferences(SIDE_RECIPE, getStorage),
		{ units: "metric", side: "", servings: 4, familyDiners: 0 },
		"a side the recipe no longer offers reads as none",
	);
	writeSidePreference(SIDE_RECIPE, "pita", getStorage);
	assert.deepEqual(JSON.parse(saved), {
		units: "metric",
		familyChoice: { otherRecipe: "rice", bowl: "pita" },
	});
	assert.deepEqual(readRecipePreferences(SIDE_RECIPE, getStorage), {
		units: "metric",
		side: "pita",
		servings: 4,
		familyDiners: 4,
	});
	writeSidePreference(SIDE_RECIPE, "", getStorage);
	assert.deepEqual(JSON.parse(saved), {
		units: "metric",
		familyChoice: { otherRecipe: "rice" },
	});
	saved = JSON.stringify({ familyChoice: ["pita"] });
	writeSidePreference(SIDE_RECIPE, "rice", getStorage);
	assert.deepEqual(JSON.parse(saved), { familyChoice: { bowl: "rice" } });

	saved = JSON.stringify({
		servings: 8,
		units: "metric",
		filters: {
			proteinChoice: ["fish"],
			mealKetoOnly: true,
			smoothieKetoOnly: true,
		},
		familyChoice: { otherRecipe: "rice", bowl: "rice" },
		appliancesOnHand: { Oven: 2 },
	});
	const sharedMeal = {
		servings: 4,
		units: "grams",
		familyDiners: 2,
		familyChoice: { bowl: "pita" },
	};
	assert.equal(
		writeRecipePreferences(SIDE_RECIPE, sharedMeal, getStorage),
		true,
	);
	assert.deepEqual(JSON.parse(saved), {
		servings: 4,
		units: "grams",
		familyDiners: 2,
		filters: { proteinChoice: ["fish"] },
		familyChoice: { otherRecipe: "rice", bowl: "pita" },
		appliancesOnHand: { Oven: 2 },
	});
	assert.deepEqual(readRecipePreferences(SIDE_RECIPE, getStorage), {
		units: "grams",
		side: "pita",
		servings: 4,
		familyDiners: 2,
	});
	assert.equal(
		writeRecipePreferences(
			SIDE_RECIPE,
			{ ...sharedMeal, familyDiners: 0, familyChoice: {} },
			getStorage,
		),
		true,
	);
	assert.deepEqual(JSON.parse(saved).familyChoice, { otherRecipe: "rice" });
	assert.deepEqual(readRecipePreferences(SIDE_RECIPE, getStorage), {
		units: "grams",
		side: "",
		servings: 4,
		familyDiners: 0,
	});
});
it("the committed audit enumerates all source and family rows with current conversion evidence", async () => {
	const committed = await readFile(
		new URL("../../../docs/recipe-units-audit.json", import.meta.url),
		"utf8",
	);
	assert.equal(
		committed === unitAudit(),
		true,
		"Stale recipe unit audit. Run node scripts/recipes/audit-units.mjs --write.",
	);
});

it("corrupt preferences recover on write while denied storage remains reported without blocking the choice", () => {
	const errors = [];
	vi.spyOn(console, "error").mockImplementation((...args) => {
		errors.push(args.join(" "));
	});
	let saved = "{broken";
	const getStorage = () => ({
		getItem: () => saved,
		setItem: (_key, value) => {
			saved = value;
		},
	});
	assert.deepEqual(readRecipePreferences(SIDE_RECIPE, getStorage), {
		units: "us",
		side: "",
		servings: 4,
		familyDiners: 0,
	});
	writeRecipePreferences(SIDE_RECIPE, { units: "grams" }, getStorage);
	assert.deepEqual(JSON.parse(saved), {
		units: "grams",
		servings: 4,
		familyDiners: 0,
		familyChoice: {},
	});
	const denied = () => {
		throw new DOMException("denied", "SecurityError");
	};
	assert.deepEqual(readRecipePreferences(SIDE_RECIPE, denied), {
		units: "us",
		side: "",
		servings: 4,
		familyDiners: 0,
	});
	writeSidePreference(SIDE_RECIPE, "rice", denied);
	assert.equal(
		writeRecipePreferences(
			SIDE_RECIPE,
			{
				units: "metric",
				servings: 4,
				familyDiners: 2,
				familyChoice: { bowl: "rice" },
			},
			denied,
		),
		false,
	);
	assert.deepEqual(errors, [
		"Recipe preferences could not be restored; using US imperial and no side. SyntaxError",
		"Malformed recipe settings were discarded while saving preferences. SyntaxError",
		"Recipe preferences could not be restored; using US imperial and no side. SecurityError",
		"Recipe side could not be saved; changes apply only to this visit. SecurityError",
		"Recipe preferences could not be saved; changes apply only to this visit. SecurityError",
	]);
});
