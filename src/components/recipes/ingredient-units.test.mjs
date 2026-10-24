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
	ingredientWeight,
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
	writeUnitPreference,
} from "./unit-preference.mjs";

const NO_OBSERVATION = /no fl oz observation/u;
const BAD_AMOUNT =
	/test-recipe\/test-ingredient: amount must be finite and positive/u;
const MISSING_REF = /missing weightRef/u;
const UNKNOWN_REF = /unknown weightRef/u;
const GRAMS = /^[\d.e+-]+ g$/u;
const GRAMS_SMALL = /^[\d.]+ g$/u;
const BAD_DISPLAY =
	/unavailable|unspecified|to taste|NaN|Infinity|undefined|~|^0(?: |g)/u;
const ANY_QUANTITY = /\S/u;
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

it("mass conversions preserve dimensions, positive tiny quantities and unrounded amounts", () => {
	assert.equal(formatIngredient(ingredient(1, "oz"), 4, "grams"), "28 g");
	assert.equal(ingredientGrams(ingredient(1, "oz")), 28.349523125);
	assert.equal(formatIngredient(ingredient(1, "lb"), 4, "metric"), "454 g");
	assert.equal(formatIngredient(ingredient(1, "oz"), 4, "us"), "1 oz");
	assert.equal(
		formatIngredient(ingredient(0.001, "g"), 2, "grams"),
		"0.0005 g",
	);
	assert.ok(
		Number.parseFloat(formatIngredient(ingredient(0.001, "g"), 2, "us")) > 0,
	);
});

it("the chaffle uses reviewed egg, cheese, almond flour and baking powder portions", () => {
	const recipe = data.recipes.find(
		(row) => row.id === "source-basic-keto-chaffle-recipe",
	);
	assert.deepEqual(
		recipe.ingredients.map((row) => formatIngredient(row, 4, "grams")),
		["100 g", "75 g", "16 g", "1.3 g"],
	);
	const exact = recipe.ingredients.map((row) => ingredientGrams(row));
	for (const [index, expected] of [100, (113 * 2) / 3, 96 / 6, 4 / 3].entries())
		assert.ok(Math.abs(exact[index] - expected) < 1e-9);
});

it("explicit references ignore ingredient prose and select the observed source unit", () => {
	const butter = weights.references.find(
		(ref) =>
			ref.measures.cup?.grams === 227 && ref.measures.tbsp?.grams === 14.2,
	);
	assert.ok(
		butter,
		"USDA butter cup and tablespoon observations remain distinct",
	);
	const row = ingredient(1, "tbsp", {
		weightRef: butter.id,
		name: "Butter or an alternative",
		state: "packed",
		note: "whipped or not",
	});
	assert.equal(ingredientGrams(row), 14.2);
	assert.equal(ingredientGrams({ ...row, unit: "cup" }), 227);
	assert.equal(formatIngredient(row, 4, "grams"), "14 g");
	const refWithoutInterpolation = weights.references.find(
		(ref) =>
			ref.kind === "mass" &&
			!ref.volumeInterpolationUnit &&
			!ref.measures["fl oz"],
	);
	assert.ok(refWithoutInterpolation);
	assert.throws(
		() =>
			ingredientGrams(
				ingredient(1, "fl oz", { weightRef: refWithoutInterpolation.id }),
			),
		NO_OBSERVATION,
	);
});

it("food-specific observed spoons override explicit volume interpolation", () => {
	const garlic = ingredient(1, "tbsp", { weightRef: "usda-171325" });
	assert.equal(ingredientGrams(garlic), 9.7);
	assert.equal(ingredientGrams({ ...garlic, unit: "tsp" }), 3.1);
	const cream = ingredient(1, "tbsp", { weightRef: "usda-170859" });
	assert.equal(ingredientGrams(cream), 15);
	assert.equal(ingredientGrams({ ...cream, unit: "cup" }), 238);
	assert.equal(ingredientGrams({ ...cream, unit: "fl oz" }), 29.75);
	assert.equal(
		formatIngredient({ ...cream, amount: 238, unit: "g" }, 4, "metric"),
		"237 mL",
	);
	assert.equal(
		formatIngredient({ ...cream, amount: 29.5735295625, unit: "ml" }, 4, "us"),
		"1 fl oz",
	);
	assert.equal(
		ingredientGrams(ingredient(1, "cup", { weightRef: "usda-173414" })),
		113,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "cup", { weightRef: "usda-171247" })),
		100,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "tbsp", { weightRef: "usda-171247" })),
		5,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "tsp", { weightRef: "usda-173468" })),
		6,
	);
	assert.equal(
		ingredientGrams(ingredient(1, "tsp", { weightRef: "morton-kosher" })),
		4.8,
	);

	const oliveOil = ingredient(1, "tbsp", { weightRef: "usda-171413" });
	assert.equal(ingredientGrams(oliveOil), 13.5);
	assert.notEqual(ingredientGrams(oliveOil), ingredientGrams(cream));
});

it("missing quantities and unresolved references fail with the ingredient identity in every mode", () => {
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

it("pressure liquid minima and whole-batch food retain their actual scaling before conversion", () => {
	const all = data.recipes.flatMap((recipe) => recipe.ingredients);
	const liquid = all.find(
		(row) => row.scale === "minimum" && row.unit === "ml",
	);
	assert.ok(liquid);
	assert.equal(ingredientAmount(liquid, 2), liquid.amount);
	assert.equal(formatIngredient(liquid, 2, "metric"), `${liquid.amount} mL`);
	assert.match(formatIngredient(liquid, 2, "grams"), GRAMS_SMALL);
	assert.equal(
		ingredientGrams(liquid, ingredientAmount(liquid, 8)),
		2 * ingredientGrams(liquid),
	);
	const bird = all.find((row) => row.scale === "whole-batch");
	assert.ok(bird);
	assert.equal(ingredientAmount(bird, 6), bird.amount * 2);
	assert.equal(
		ingredientGrams(bird, ingredientAmount(bird, 6)),
		ingredientGrams(bird) * 2,
	);
});

it("liquid mass uses its own density and meaningful alternatives resolve independently", () => {
	const liquids = weights.references.filter(
		(ref) => ref.kind === "liquid" && ref.gramsPerMl > 0,
	);
	assert.ok(liquids.length >= 2);
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
	const metric = ingredientMeasure(
		row,
		row.amount * 1.5,
		"metric",
		formatQuantity,
	);
	assert.equal(metric.quantity, "150 mL");
	assert.equal(metric.alternatives[0].quantity, "300 mL");
	assert.equal(metric.alternatives[0].name, "Alternative liquid");
	const grams = ingredientMeasure(
		row,
		row.amount * 1.5,
		"grams",
		formatQuantity,
	);
	assert.equal(grams.grams, row.amount * 1.5);
	assert.ok(
		Math.abs(grams.alternatives[0].grams - second.gramsPerMl * 300) < 1e-9,
	);
});

it("every recipe and family choice has numeric mode-appropriate displays across the full serving matrix", () => {
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
					...document.sideOptions.map((option) => ({
						quantity: option.quantityPerPerson,
					})),
					...(document.sideIngredient ? [document.sideIngredient] : []),
				]) {
					assert.ok(
						!BAD_DISPLAY.test(row.quantity),
						`${recipe.id}: ${row.quantity}`,
					);
					assert.match(row.quantity, units === "grams" ? GRAMS : ANY_QUANTITY);
				}
				const markdown = documentMarkdown(document);
				const restored = JSON.parse(JSON.stringify(document));
				const grid = flowGrid(recipe, { servings, units });
				assert.ok(!markdown.includes("weight unavailable"));
				for (const [index, row] of recipe.ingredients.entries()) {
					const amount = ingredientAmount(row, servings);
					const shown = ingredientMeasure(row, amount, units, formatQuantity);
					assert.equal(shown.grams, ingredientGrams(row, amount));
					assert.equal(document.ingredients[index].quantity, shown.quantity);
					assert.equal(formatIngredient(row, servings, units), shown.quantity);
					assert.deepEqual(
						restored.ingredients[index].alternatives,
						shown.alternatives,
					);
					for (const [choiceIndex, choice] of (
						row.alternatives || []
					).entries()) {
						const displayed = shown.alternatives[choiceIndex];
						assert.equal(displayed.name, choice.name);
						assert.ok(displayed.grams > 0 && Number.isFinite(displayed.grams));
						assert.match(
							displayed.quantity,
							units === "grams" ? GRAMS : ANY_QUANTITY,
						);
						assert.ok(!BAD_DISPLAY.test(displayed.quantity));
						assert.ok(
							units !== "metric" ||
								displayed.status ===
									(ingredientWeight(choice).kind === "liquid"
										? "volume"
										: "mass"),
						);
						assert.ok(
							markdown.includes(` or ${displayed.quantity} ${choice.name}`),
						);
						const leaves = grid.rows.filter(
							(leaf) => leaf.ingredient.ingredientId === row.id,
						);
						assert.ok(leaves.length > 0);
						const allocated = leaves.map(
							(leaf) =>
								leaf.cells.find((cell) => cell.kind === "ingredient")
									.alternatives[choiceIndex],
						);
						assert.ok(
							allocated.every(
								(part) => part.name === choice.name && part.grams > 0,
							),
						);
						assert.ok(
							Math.abs(
								allocated.reduce((sum, part) => sum + part.grams, 0) -
									displayed.grams,
							) < 1e-8,
						);
					}

					assert.ok(
						units !== "metric" ||
							shown.status ===
								(ingredientWeight(row).kind === "liquid" ? "volume" : "mass"),
					);
				}
				for (const option of recipe.familyOptions)
					for (let diners = 1; diners <= servings; diners++) {
						const shown = ingredientMeasure(
							option,
							option.amount * diners,
							units,
							formatQuantity,
						);
						assert.ok(
							Math.abs(shown.grams - ingredientGrams(option) * diners) < 1e-8,
						);
						assert.match(
							shown.quantity,
							units === "grams" ? GRAMS : ANY_QUANTITY,
						);
					}
			}
	assert.equal(JSON.stringify(data), before);
});

it("lettuce-wrap liquid choices preserve independent source weights in JSON, Markdown and flow HTML", () => {
	const recipe = data.recipes.find(
		(row) => row.id === "source-keto-asian-chicken-lettuce-wraps",
	);
	// USDA SR Legacy: ready-to-serve chicken broth 249 g/cup (174536),
	// white table wine 29.4 g/fl oz (174837). NIST cup 236.5882365 mL;
	// the reviewed potable-water cooking convention is 1 g/mL.
	const baseGrams = [249 / 4, 236.5882365 / 4, 29.4 * 2];
	const names = ["chicken broth", "Water", "White wine"];
	const expected = {
		2: { grams: ["31 g", "30 g", "29 g"], metric: "30 mL", us: "⅛ cup" },
		4: { grams: ["62 g", "59 g", "59 g"], metric: "59 mL", us: "¼ cup" },
		6: { grams: ["93 g", "89 g", "88 g"], metric: "89 mL", us: "⅜ cup" },
		8: { grams: ["125 g", "118 g", "118 g"], metric: "118 mL", us: "½ cup" },
	};
	for (const servings of [2, 4, 6, 8])
		for (const units of ["grams", "metric", "us"]) {
			const document = recipeDocument(recipe, { servings, units });
			const row = JSON.parse(JSON.stringify(document)).ingredients.find(
				(item) => item.name === names[0],
			);
			const choices = [row, ...row.alternatives];
			const quantities =
				units === "grams"
					? expected[servings].grams
					: new Array(3).fill(expected[servings][units]);
			assert.deepEqual(
				choices.map((choice) => choice.name),
				names,
			);
			assert.deepEqual(
				choices.map((choice) => choice.quantity),
				quantities,
			);
			for (const [index, choice] of choices.entries())
				assert.ok(
					Math.abs(choice.grams - (baseGrams[index] * servings) / 4) < 1e-9,
				);
			const markdown = documentMarkdown(document);
			assert.ok(
				markdown.includes(
					`- ${quantities[0]} chicken broth or ${quantities[1]} Water or ${quantities[2]} White wine`,
				),
			);
			for (const html of [
				gridHtml(recipe.title, flowGrid(recipe, { servings, units })),
				markdown,
			]) {
				const dom = new JSDOM(html);
				try {
					const cell = [
						...dom.window.document.querySelectorAll("th.trn-ingredient"),
					].find((item) => item.textContent.includes("chicken broth"));
					assert.ok(cell);
					assert.deepEqual(
						[...cell.querySelectorAll("strong")].map(
							(strong) => strong.textContent,
						),
						quantities,
					);
					assert.ok(
						cell.textContent.includes(
							`or ${quantities[1]} Water or ${quantities[2]} White wine`,
						),
					);
				} finally {
					dom.window.close();
				}
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
	writeUnitPreference("grams", () => storage);
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
	writeUnitPreference("grams", getStorage);
	assert.deepEqual(JSON.parse(saved), { units: "grams" });
	const denied = () => {
		throw new DOMException("denied", "SecurityError");
	};
	assert.deepEqual(readRecipePreferences(SIDE_RECIPE, denied), {
		units: "us",
		side: "",
		servings: 4,
		familyDiners: 0,
	});
	writeUnitPreference("metric", denied);
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
		"Malformed recipe settings were discarded while saving units. SyntaxError",
		"Recipe preferences could not be restored; using US imperial and no side. SecurityError",
		"Recipe units could not be saved; changes apply only to this visit. SecurityError",
		"Recipe side could not be saved; changes apply only to this visit. SecurityError",
		"Recipe preferences could not be saved; changes apply only to this visit. SecurityError",
	]);
});
