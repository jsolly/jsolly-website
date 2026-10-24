import assert from "node:assert/strict";
import { it } from "vitest";
import { archivedRecipes } from "./archived-recipes.test-data.mjs";
import recipeData, { ingredientWithContext } from "./recipe-data.server.mjs";
import {
	capacityNote,
	dietaryClass,
	formatIngredient,
	formatQuantity,
	ingredientAmount,
	selectedSide,
	servingNutrition,
	shuffleRecipes,
	sideNutrition,
	temperature,
	validateSettings,
} from "./recipe-logic.mjs";

const WEIGHED = /g/u;
const IMPERIAL_MEASURE = /tsp|g|oz/u;
const EXTRA_BATCHES = /extra pan or basket batches/u;
const PRESSURE_MINIMUM = /do not shorten a pressure minimum/u;
const ABOUT_ONE_CAN = /About 1 ×/u;
const ABOUT_FOUR_CANS = /About 4 ×/u;
const BUY_TWO = /Buy 2 ×/u;
const MICROWAVE = /microwave/iu;
const YIELD = /yield/u;
const POSITIVE_GLASS = /positive glass/u;
const BAD_MEASUREMENT = /amount must be finite and positive/u;

const ingredient = (id, name, amount, unit, state = "raw", extra = {}) =>
	ingredientWithContext({
		id,
		name,
		amount,
		unit,
		state,
		category: "produce",
		scale: "linear",
		...extra,
	});
const nutrition = {
	kcal: 400,
	protein_g: 35,
	carbs_g: 12,
	fiber_g: 3,
	net_carbs_g: 9,
};
const chicken = {
	id: "chicken",
	key: "salsa_chicken",
	title: "Salsa chicken",
	proteinType: "chicken",
	vegetarian: false,
	appliance: "instant-pot",
	activeMinutes: 15,
	totalMax: 45,
	timeVariable: true,
	allergens: [],
	boosters: ["hemp hearts"],
	ingredients: [
		ingredient("chicken-breast", "chicken breast", 800, "g", "raw", {
			category: "meat",
			us: { amount: 1.75, unit: "lb" },
		}),
		ingredient("lime", "lime juice", 30, "ml", "juiced", {
			weightRef: "usda-168156",
			us: { amount: 2, unit: "tbsp" },
		}),
		ingredient("salt", "salt", 1, "tsp", "dry", {
			weightRef: "usda-173468",
			category: "pantry",
			scale: "minimum",
			us: { amount: 1, unit: "tsp" },
		}),
	],
	familyOptions: [
		{
			id: "rice",
			label: "Brown rice",
			ingredientId: "rice",
			ingredientName: "cooked brown rice",
			amount: 150,
			unit: "g",
			state: "cooked",
			category: "grains",
			nutrition: {
				kcal: 166,
				protein_g: 4,
				carbs_g: 34,
				fiber_g: 2,
				net_carbs_g: 32,
			},
		},
	],
	nutrition,
};

it("familiar fractions, typed US measures, and seasoning rules survive serving changes", () => {
	assert.equal(formatQuantity(1.5), "1 ½");
	assert.equal(formatQuantity(0.3333), "⅓");
	assert.equal(formatQuantity(37.5), "37.5");
	assert.equal(formatIngredient(chicken.ingredients[1], 2, "us"), "0.51 fl oz");
	assert.equal(formatIngredient(chicken.ingredients[1], 2, "metric"), "15 mL");
	assert.equal(formatIngredient(chicken.ingredients[0], 8, "us"), "3.53 lb");
	assert.equal(ingredientAmount(chicken.ingredients[2], 2), 1);
	assert.equal(formatIngredient(chicken.ingredients[2], 2, "us"), "1 tsp");
	assert.equal(ingredientAmount(chicken.ingredients[2], 8), 2);
	const fixedEgg = ingredient("egg", "beaten egg", 1, "count", "beaten", {
		scale: "fixed",
		weightRef: "usda-171287",
	});
	assert.equal(ingredientAmount(fixedEgg, 8), 1);
	const linearEgg = { ...fixedEgg, scale: "linear" };
	assert.equal(formatIngredient(linearEgg, 2), "25 g");
	assert.throws(
		() => formatIngredient(ingredient("pepper", "black pepper", 0, "tsp"), 8),
		BAD_MEASUREMENT,
	);
});

it("temperature keeps the source setting and rounds safe endpoints upward", () => {
	assert.equal(temperature(425, "metric"), "220°C (425°F)");
	assert.equal(temperature(165, "metric", true), "74°C (165°F)");
	assert.equal(temperature(145, "metric", true), "63°C (145°F)");
	assert.equal(temperature(165, "us", true), "165°F");
});

it("explicit side macros exclude the base and leave it intact", () => {
	const before = structuredClone(chicken);
	assert.deepEqual(sideNutrition(chicken, "rice"), {
		kcal: 166,
		fat_g: null,
		protein_g: 4,
		carbs_g: 34,
		fiber_g: 2,
		net_carbs_g: 32,
	});
	assert.deepEqual(sideNutrition(chicken, "unknown"), null);
	assert.deepEqual(chicken, before);
});

it("invalid settings fail to a safe four-serving settings and capacity messaging is honest", () => {
	assert.deepEqual(
		validateSettings({ servings: 5, familyDiners: -1, units: "cups" }),
		{
			servings: 4,
			familyDiners: 0,
			units: "us",
		},
	);
	assert.deepEqual(
		validateSettings({ servings: 6, familyDiners: 20, units: "metric" }),
		{
			servings: 6,
			familyDiners: 6,
			units: "metric",
		},
	);
	assert.match(capacityNote(8), EXTRA_BATCHES);
	assert.match(capacityNote(2), PRESSURE_MINIMUM);
});

it("pressure minimum changes small-batch per-person nutrition, not safe liquid", () => {
	const data = recipeData.recipes;
	const pressure = data.find((r) => r.key === "salsa_chicken");
	const p = servingNutrition(pressure, 2);
	// USDA broth is 240 g per US cup; minimum 375 mL contributes a fixed batch.
	const extra = (375 * 240) / 236.5882365 / 400;
	assert(Math.abs(p.kcal - pressure.nutrition.kcal - extra * 7) < 1e-10);
	assert(
		Math.abs(p.protein_g - pressure.nutrition.protein_g - extra * 1.36) < 1e-10,
	);
	assert(
		Math.abs(p.carbs_g - pressure.nutrition.carbs_g - extra * 0.38) < 1e-10,
	);
	assert.deepEqual(servingNutrition(pressure, 4), {
		...pressure.nutrition,
		fat_g: 13.30389625,
	});
	assert.deepEqual(servingNutrition(pressure, 8), {
		...pressure.nutrition,
		fat_g: 13.30389625,
	});
	assert.deepEqual(sideNutrition(pressure, "bogus"), null);
});

it("package counts follow scaled ingredient weights rather than fixed recipe notes", async () => {
	const { purchaseNote } = await import("./recipe-logic.mjs");
	const data = recipeData.recipes;
	const chickpea = archivedRecipes
		.find((r) => r.key === "chickpea")
		.ingredients.find((i) => i.id === "chickpeas_canned");
	assert.match(purchaseNote(chickpea, 2), ABOUT_ONE_CAN);
	assert.match(purchaseNote(chickpea, 8), ABOUT_FOUR_CANS);
	const spinach = data
		.find((r) => r.key === "frittata")
		.ingredients.find((i) => i.id === "spinach_frozen");
	assert.match(purchaseNote(spinach, 8), BUY_TWO);
	const gnocchi = archivedRecipes
		.find((r) => r.key === "gnocchi")
		.ingredients.find((i) => i.id === "shelf_stable_gnocchi");
	assert.match(purchaseNote(gnocchi, 8), BUY_TWO);
});

it("finishing amounts use sourced grams in weighing mode and retain spoons in US mode", () => {
	const data = recipeData.recipes;
	for (const r of data)
		for (const i of r.ingredients.filter(
			(item) => item.displayMeasure === "spoon",
		))
			for (const count of [2, 4, 6, 8]) {
				assert.match(formatIngredient(i, count, "grams"), WEIGHED);
				assert.match(formatIngredient(i, count, "us"), IMPERIAL_MEASURE);
			}
	const zest = data
		.find((r) => r.key === "salmon")
		.ingredients.find((i) => i.id === "lemon_zest");
	assert.equal(zest.amount, 2);
	assert.equal(formatIngredient(zest, 2, "metric"), "1 g");
});

it("appliance card requirements include the microwaves specified by recipe equipment", () => {
	const data = recipeData.recipes;
	for (const recipe of data) {
		assert.ok(recipe.appliancesNeeded.length > 0);
		assert.equal(
			new Set(recipe.appliancesNeeded).size,
			recipe.appliancesNeeded.length,
		);
		assert.ok(
			!recipe.equipment.some((item) => MICROWAVE.test(item)) ||
				recipe.appliancesNeeded.includes("Microwave"),
			recipe.id,
		);
	}
});

it("shuffle preserves the source and visits every index with a fresh random choice", () => {
	const source = ["a", "b", "c", "d"];
	let calls = 0;
	const shuffled = shuffleRecipes(source, () => {
		calls++;
		return 0;
	});
	assert.deepEqual(source, ["a", "b", "c", "d"]);
	assert.deepEqual(shuffled, ["b", "c", "d", "a"]);
	assert.equal(calls, source.length - 1);
	assert.deepEqual(
		shuffleRecipes(source, () => 0.99),
		source,
	);
	assert.deepEqual(shuffleRecipes([]), []);
	assert.deepEqual(shuffleRecipes(["one"]), ["one"]);
});

it("gram threshold preserves subgram source measures", () => {
	const i = ingredient("spice", "spice", 1, "g", "dry", {
		displayMeasure: "spoon",
		us: { amount: 0.5, unit: "tsp" },
	});
	assert.equal(formatIngredient(i, 4, "us"), "0.04 oz");
	assert.equal(formatIngredient(i, 2, "us"), "0.02 oz");
});

it("display rounds gram amounts without changing scaling weights", () => {
	const i = ingredient("paprika", "paprika", 2.3, "g");
	for (const count of [2, 4, 6, 8])
		assert.equal(
			formatIngredient(i, count, "grams"),
			`${Number(((2.3 * count) / 4).toFixed(1))} g`,
		);
	assert.ok(Math.abs(ingredientAmount(i, 6) - 3.45) < 1e-10);
});

it("smoothie nutrition uses explicit estimated fluid yield, independent of batch selection", async () => {
	const { smoothiePortionNutrition } = await import("./recipe-logic.mjs");
	const smoothie = {
		type: "smoothie",
		estimatedYieldMl: 800,
		nutrition: {
			kcal: 200,
			protein_g: 10,
			carbs_g: 12,
			fiber_g: 4,
			net_carbs_g: 8,
		},
	};
	const portion = smoothiePortionNutrition(smoothie);
	assert.ok(Math.abs(portion.net_carbs_g - 9.46352946) < 1e-7);
	assert.ok(
		Math.abs(
			smoothiePortionNutrition(smoothie, 4).net_carbs_g -
				portion.net_carbs_g / 2,
		) < 1e-9,
	);
	assert.throws(
		() =>
			smoothiePortionNutrition({ ...smoothie, estimatedYieldMl: undefined }),
		YIELD,
	);
	assert.throws(() => smoothiePortionNutrition(smoothie, 0), POSITIVE_GLASS);
});
it("smoothie liquid keeps fluid-ounce precision without changing the canonical amount", () => {
	const water = ingredientWithContext({
		id: "water",
		name: "Cold water",
		weightRef: "water",
		amount: 400,
		unit: "ml",
		scale: "linear",
	});
	assert.equal(formatIngredient(water, 4, "us"), "13.53 fl oz");
	assert.equal(formatIngredient(water, 2, "us"), "6.76 fl oz");
	assert.equal(formatIngredient(water, 4, "metric"), "400 mL");
	assert.equal(formatIngredient(water, 4, "grams"), "400 g");
	assert.equal(water.amount, 400);
});

it("dietary classification includes 12.5 g and optional sides default to none", () => {
	const recipe = {
		...chicken,
		id: "dietary-fixture",
		nutrition: { ...nutrition, carbs_g: 15.5, net_carbs_g: 12.5 },
	};
	assert.equal(dietaryClass(recipe), "keto");
	assert.equal(
		dietaryClass({
			...recipe,
			nutrition: {
				...recipe.nutrition,
				carbs_g: 15.5001,
				net_carbs_g: 12.5001,
			},
		}),
		"nonketo",
	);
	assert.equal(selectedSide(recipe), undefined);
	assert.equal(selectedSide(recipe, "stale"), undefined);
	assert.equal(selectedSide(recipe, ""), undefined);
	assert.equal(selectedSide(recipe, "rice"), recipe.familyOptions[0]);
	assert.equal(sideNutrition(recipe), null);
	assert.equal(dietaryClass(recipe), "keto");
});
