import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import it from "node:test";
import { unitAudit } from "../../../scripts/recipes/audit-units.mjs";
import { ingredientWeight, unitPreference } from "./ingredient-units.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";
import { formatIngredient, ingredientAmount } from "./recipe-logic.mjs";
import { readRecipeURL, recipeHref } from "./recipe-url.mjs";
import data from "./recipes.json" with { type: "json" };
import { readUnitPreference, writeUnitPreference } from "./unit-preference.mjs";

const INVALID_DISPLAY = /NaN|Infinity|undefined|^0(?: |g)/u;
const ingredient = (
	amount,
	unit,
	name = "unidentified ingredient",
	extra = {},
) => ({ amount, unit, name, scale: "linear", ...extra });
it("mass and US fluid ounces have different dimensions and convert from canonical quantities", () => {
	assert.equal(formatIngredient(ingredient(1, "oz"), 4, "grams"), "28 g");
	assert.equal(formatIngredient(ingredient(1, "lb"), 4, "metric"), "454 g");
	assert.equal(
		formatIngredient(ingredient(29.5735295625, "ml"), 4, "us"),
		"1 fl oz",
	);
	assert.equal(
		formatIngredient(ingredient(1, "cup"), 4, "metric"),
		"237 mL volume (1 cup)",
	);
	assert.equal(formatIngredient(ingredient(1, "oz"), 4, "us"), "1 oz");
});
it("weighing uses food-specific sourced portions and retains approximate source measures", () => {
	assert.equal(
		formatIngredient(ingredient(1, "tbsp", "Olive oil"), 4, "grams"),
		"~14 g (1 tbsp)",
	);
	assert.equal(
		formatIngredient(ingredient(1, "tbsp", "Garlic powder"), 4, "grams"),
		"~9.7 g (1 tbsp)",
	);
	assert.equal(
		formatIngredient(ingredient(1, "cup", "Heavy cream"), 4, "grams"),
		"~238 g (1 cup)",
	);
	assert.equal(
		formatIngredient(ingredient(1, "cup", "Heavy cream"), 4, "metric"),
		"237 mL volume (1 cup)",
	);
	assert.equal(ingredientWeight(ingredient(1, "cup", "Kosher salt")), null);
	const frittata = data.recipes.find(
		(recipe) => recipe.id === "spinach-feta-and-hemp-frittata",
	);
	assert.equal(
		formatIngredient(
			frittata.ingredients.find((row) => row.id === "egg"),
			4,
			"grams",
		),
		"~600 g edible egg, without shells (12 count)",
	);
	assert.equal(
		ingredientWeight(
			ingredient(1, "cup", "fresh chopped cilantro", { note: "or parsley" }),
		),
		null,
	);
	assert.equal(
		ingredientWeight(ingredient(1, "cup", "butter or olive oil")),
		null,
	);
});
it("missing, to-taste, counts, packages and undefined spoons never acquire invented weights", () => {
	for (const units of ["grams", "us", "metric"]) {
		assert.equal(
			formatIngredient(ingredient(null, "g"), 4, units),
			"Not specified",
		);
		assert.equal(formatIngredient(ingredient(0, "tsp"), 4, units), "to taste");
	}
	for (const unit of [
		"count",
		"package",
		"can",
		"bunch",
		"coffeespoon",
		"pinch",
		"",
	]) {
		const i = ingredient(1, unit);
		assert.equal(
			formatIngredient(i, 2, "grams"),
			`½${unit ? ` ${unit}` : ""} (weight unavailable)`,
		);
	}
});
it("small quantities, whole batches and minimums survive display and unit switching without mutation", () => {
	const i = ingredient(0.001, "g");
	assert.equal(formatIngredient(i, 2, "grams"), "<0.01 g");
	assert.equal(formatIngredient(i, 2, "us"), "<0.01 oz");
	const liquid = ingredient(375, "ml", "Low-sodium chicken broth", {
		scale: "minimum",
	});
	assert.equal(ingredientAmount(liquid, 2), 375);
	assert.equal(
		formatIngredient(liquid, 2, "metric"),
		"375 mL minimum (measure by volume)",
	);
	const bird = ingredient(1, "count", "whole chicken", {
		scale: "whole-batch",
	});
	assert.equal(
		formatIngredient(bird, 6, "grams"),
		"2 count (weight unavailable)",
	);
	assert.equal(ingredientAmount(bird, 6), 2);
});
it("every recipe and family ingredient has finite, nonzero display coverage in every mode and serving choice", () => {
	const before = JSON.stringify(data);
	for (const recipe of data.recipes)
		for (const servings of [2, 4, 6, 8])
			for (const units of ["grams", "us", "metric"]) {
				const document = recipeDocument(recipe, {
					servings,
					units,
					familyDiners: servings,
				});
				for (const row of [
					...document.ingredients,
					...document.familyOptions.map((o) => ({
						quantity: o.quantityPerPerson,
					})),
					...(document.familyIngredient ? [document.familyIngredient] : []),
				]) {
					assert.ok(
						!INVALID_DISPLAY.test(row.quantity),
						`${recipe.id}: ${row.quantity}`,
					);
				}
				assert.ok(
					documentMarkdown(document).includes(document.measurementPolicy),
				);
			}
	assert.equal(JSON.stringify(data), before);
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
it("individual-page unit preference updates preserve every unrelated saved field", () => {
	const prior = {
		servings: 8,
		filters: { ingredientChoice: ["hemp"], proteinChoice: ["fish"] },
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
	writeUnitPreference("grams", () => storage);
	assert.equal(
		readUnitPreference(() => storage),
		"grams",
	);
	assert.deepEqual(JSON.parse(saved), { ...prior, units: "grams" });
});
it("the committed audit enumerates all source and family rows with current conversion evidence", async () => {
	assert.equal(
		await readFile(
			new URL("../../../docs/recipe-units-audit.json", import.meta.url),
			"utf8",
		),
		unitAudit(),
	);
});

it("corrupt preferences recover on write while denied storage remains reported without blocking the choice", (t) => {
	const errors = [];
	t.mock.method(console, "error", (...args) => {
		errors.push(args.join(" "));
	});
	let saved = "{broken";
	const getStorage = () => ({
		getItem: () => saved,
		setItem: (_key, value) => {
			saved = value;
		},
	});
	assert.equal(readUnitPreference(getStorage), "us");
	writeUnitPreference("grams", getStorage);
	assert.deepEqual(JSON.parse(saved), { units: "grams" });
	const denied = () => {
		throw new DOMException("denied", "SecurityError");
	};
	assert.equal(readUnitPreference(denied), "us");
	writeUnitPreference("metric", denied);
	assert.deepEqual(errors, [
		"Recipe units could not be restored; using US imperial. SyntaxError",
		"Malformed recipe settings were discarded while saving units. SyntaxError",
		"Recipe units could not be restored; using US imperial. SecurityError",
		"Recipe units could not be saved; changes apply only to this visit. SecurityError",
	]);
});
