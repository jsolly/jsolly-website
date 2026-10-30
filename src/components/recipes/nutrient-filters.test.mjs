import assert from "node:assert/strict";
import { it } from "vitest";
import {
	DEFAULT_FILTERS,
	defaultAppliances,
	starchOptions,
	starchTypes,
} from "./constants.mjs";
import {
	hasAppliances,
	matchesRecipe,
	nutrientFilters,
	smoothieIngredientChoices,
} from "./nutrient-filters.mjs";
import { recordedOmega3 } from "./nutrition.mjs";
import data from "./recipe-data.server.mjs";
import { displayNutrition, ingredientAmount } from "./recipe-logic.mjs";
import {
	availableAppliances,
	normalizeSelection,
	parseSavedSettings,
} from "./recipe-settings.mjs";

it("nutrition filters have usable intersections at all supported serving counts", () => {
	for (const servings of [2, 4, 6, 8])
		for (const immune of [false, true])
			for (const iron of [false, true]) {
				const matches = data.recipes.filter((r) => {
					const flags = nutrientFilters(r, servings);
					return (!immune || flags.immune) && (!iron || flags.iron);
				});
				assert(matches.length > 0);
				// Any active filter must also exclude something.
				assert(!(immune || iron) || matches.length < data.recipes.length);
			}
	const cod = data.recipes.find((r) => r.key === "cod");
	assert.deepEqual(nutrientFilters(cod, 4), {
		immune: false,
		iron: false,
		omega: true,
	});
	assert.deepEqual(nutrientFilters({ id: "missing", ingredients: [] }, 4), {
		immune: false,
		iron: false,
		omega: false,
	});
});

const legacyRecipes = data.recipes.filter((recipe) => !recipe.sourceRecipe);

it("protein categories combine with nutrient criteria", () => {
	const fish = legacyRecipes.filter((r) =>
		matchesRecipe(r, 4, { protein: ["fish"] }),
	);
	assert.equal(fish.length, 2);
	assert(fish.every((r) => r.proteinType === "fish"));
	assert.equal(
		legacyRecipes.filter((r) =>
			matchesRecipe(r, 4, { protein: ["fish"], iron: true }),
		).length,
		0,
	);
	const ketoChicken = legacyRecipes.filter((r) =>
		matchesRecipe(r, 4, { protein: ["chicken"] }),
	);
	assert.ok(ketoChicken.length > 0);
	assert(
		ketoChicken.every(
			(r) =>
				displayNutrition(r).net_carbs_g <= 12.5 && r.proteinType === "chicken",
		),
	);
});

it("starch categories cover every recipe and include main ingredients and family sides", () => {
	for (const recipe of data.recipes) {
		assert(
			Array.isArray(recipe.starches),
			`${recipe.id}: starches is an array`,
		);
		assert(
			recipe.starches.length > 0,
			`${recipe.id}: starch category required`,
		);
		assert.equal(new Set(recipe.starches).size, recipe.starches.length);
		for (const type of recipe.starches)
			assert(
				typeof type === "string" &&
					type !== "all" &&
					Object.hasOwn(starchTypes, type),
				`${recipe.id}: unknown starch category ${type}`,
			);
	}
	const ids = (starch) =>
		legacyRecipes
			.filter((r) => matchesRecipe(r, 4, { starch: [starch] }))
			.map((r) => r.id);
	assert.deepEqual(ids("rice").sort(), [
		"salsa-verde-shredded-chicken",
		"shawarma-chicken-bowls",
	]);
	assert.deepEqual(ids("pasta"), []);
	assert.ok(ids("none").length > 0);
	assert.equal(ids("bread").length, 3);
});

it("multi-select uses OR within each filter and AND across filters; saved selections normalize", () => {
	const matches = (filters) =>
		legacyRecipes.filter((r) => matchesRecipe(r, 4, filters));
	assert.equal(matches({ starch: ["rice", "pasta"] }).length, 2);
	assert.equal(matches({ protein: ["fish", "turkey"] }).length, 4);
	assert.equal(
		matches({ protein: ["fish", "chicken"], starch: ["rice"] }).length,
		2,
	);
	assert.equal(
		matches({ protein: [], starch: [] }).length,
		legacyRecipes.length,
	);
	assert.deepEqual(
		normalizeSelection(["rice", "rice", "invalid", "all"], starchOptions),
		["rice"],
	);
	assert.deepEqual(normalizeSelection("rice", starchOptions), []);
});

it("retired dietary filters do not change current recipe matches", () => {
	for (const recipe of data.recipes) {
		for (const servings of [2, 4, 6, 8]) {
			assert.equal(
				matchesRecipe(recipe, servings, { carb: ["nonketo"] }),
				true,
				recipe.id,
			);
		}
	}
	const saved = parseSavedSettings(
		{ filters: { mealKetoOnly: true, smoothieKetoOnly: true } },
		{ recipes: data.recipes, ingredients: {} },
	);
	assert.equal(Object.hasOwn(saved.filters, "mealKetoOnly"), false);
	assert.equal(Object.hasOwn(saved.filters, "smoothieKetoOnly"), false);
});

it("appliance inventory honors counts and explicit heat sources, and validates saved counts", () => {
	const fry = data.recipes.find((r) => r.id === "greek-turkey-patties");
	assert(!hasAppliances(fry, { ...defaultAppliances, "Two air fryers": 1 }));
	assert(hasAppliances(fry, defaultAppliances));
	const pan = data.recipes.find(
		(r) => r.id === "pan-fried-greek-turkey-patties",
	);
	assert(hasAppliances(pan, defaultAppliances));
	assert(hasAppliances(pan, { ...defaultAppliances, Oven: 0 }));
	assert(!hasAppliances(pan, { ...defaultAppliances, Stovetop: 0 }));
	assert.equal(availableAppliances({ "Instant Pot": 8 })["Instant Pot"], 2);
	assert.equal(availableAppliances({ Oven: 0 }).Oven, 0);
	assert.deepEqual(availableAppliances(null), defaultAppliances);
	assert.equal(data.recipes.filter((r) => r.type === "smoothie").length, 4);
	assert(
		data.recipes
			.filter((r) => r.type === "smoothie")
			.every((r) => r.appliancesNeeded.includes("Blender")),
	);
});

it("smoothie ingredient filters use actual ingredients and exclude shared bases", () => {
	const choices = smoothieIngredientChoices(data.recipes);
	assert(!("water" in choices));
	assert(!("yogurt" in choices));
	assert.equal(choices.hemp, "Hulled hemp hearts");
	assert.equal(choices.spinach, "Raw spinach");
	const smoothies = data.recipes.filter((r) => r.type === "smoothie");
	assert.deepEqual(
		smoothies
			.filter((r) => matchesRecipe(r, 4, { ingredients: ["hemp"] }))
			.map((r) => r.id),
		["strawberry-hemp-smoothie"],
	);
	assert.deepEqual(
		smoothies
			.filter((r) => matchesRecipe(r, 4, { ingredients: ["hemp", "spinach"] }))
			.map((r) => r.id),
		["strawberry-hemp-smoothie", "cucumber-spinach-lime-smoothie"],
	);
	assert.deepEqual(
		smoothies
			.filter((r) =>
				matchesRecipe(r, 4, { ingredients: ["hemp"], carb: ["nonketo"] }),
			)
			.map((r) => r.id),
		["strawberry-hemp-smoothie"],
	);
	assert.equal(
		smoothies.filter((r) => matchesRecipe(r, 4, { ingredients: [] })).length,
		4,
	);
});

it("omega filter uses recorded quantities on meal and smoothie portion bases", () => {
	const ids = data.recipes
		.filter((r) => matchesRecipe(r, 4, { omega: true }))
		.map((r) => r.id);
	assert.deepEqual(ids, [
		"lemon-salmon-and-asparagus",
		"pesto-cod-and-zucchini",
		"spinach-feta-and-hemp-frittata",
		"strawberry-hemp-smoothie",
		"source-steak-and-eggs-keto-low-carb",
		"source-grilled-salmon-kabobs-with-greek-marinade",
		"source-sheet-pan-butter-dill-salmon-with-asparagus",
		"source-salmon-with-jalapen-o-lime-butter-keto-low-carb",
		"source-keto-parmesan-tilapia-and-asparagus-for-one",
		"source-creamy-tuscan-salmon-recipe",
		"source-garlic-butter-salmon-with-lemon-asparagus",
		"source-lemon-garlic-butter-salmon-with-zucchini-noodles",
		"source-creamy-garlic-pesto-chicken",
		"source-easy-cajun-pork-chops-with-lemon-garlic-zucchini",
		"keto-fried-calamari",
	]);
	// USDA172336 records 9.137 g ALA per 100 g canola oil. The recipe's measured
	// two tablespoons weigh 28 g and alone exceed 0.5 g in one quarter batch.
	const pork = data.recipes.find(
		(recipe) =>
			recipe.id === "source-easy-cajun-pork-chops-with-lemon-garlic-zucchini",
	);
	const canola = pork.calculation.rows.find(
		(row) => row.ingredientId === "ingredient-4",
	);
	assert.equal(canola.fdcId, 172336);
	assert.equal(canola.grams, 28);
	assert.equal(canola.omega3RecordedGramsPer100g, 9.137);
	assert.ok((28 * 9.137) / 400 >= 0.5);
	for (const n of [2, 6, 8])
		assert.deepEqual(
			data.recipes
				.filter((r) => matchesRecipe(r, n, { omega: true }))
				.map((r) => r.id),
			ids,
		);
});

it("omega filter includes the 0.5 g boundary and excludes lower or unobserved quantities", () => {
	const recipe = data.recipes.find((r) => r.id === "strawberry-hemp-smoothie");
	const recorded = recordedOmega3(recipe, 4, ingredientAmount);
	const boundaryYield = (recipe.estimatedYieldMl * recorded) / 0.5;
	const boundary = { ...recipe, estimatedYieldMl: boundaryYield };
	assert(Math.abs(recordedOmega3(boundary, 4, ingredientAmount) - 0.5) < 1e-12);
	assert.equal(nutrientFilters(boundary, 4).omega, true);
	assert.equal(
		nutrientFilters({ ...boundary, estimatedYieldMl: boundaryYield * 1.001 }, 4)
			.omega,
		false,
	);
	assert.equal(
		nutrientFilters(
			{ ...boundary, id: "unobserved-omega-fixture", calculation: undefined },
			4,
		).omega,
		false,
	);
});

const ingredients = smoothieIngredientChoices(data.recipes);
const context = { recipes: data.recipes, ingredients };

it("saved library settings restore as saved when every value is still offered", () => {
	const saved = {
		servings: 8,
		familyDiners: 2,
		units: "metric",
		filters: {
			proteinChoice: ["fish", "turkey"],
			starchChoice: ["bread"],
			ingredientChoice: ["hemp"],
			vegetarianOnly: true,
			immuneSupport: true,
			ironRich: true,
			omega3: true,
			dumpAndGo: true,
		},
		appliancesOnHand: { ...defaultAppliances, Oven: 0, "Two air fryers": 1 },
		familyChoice: { "shawarma-chicken-bowls": "pita_one" },
	};
	assert.deepEqual(
		parseSavedSettings(JSON.parse(JSON.stringify(saved)), context),
		saved,
	);
	const legacy = { ...saved, familyDiners: undefined };
	assert.equal(parseSavedSettings(legacy, context).familyDiners, 8);
	assert.equal(
		parseSavedSettings({ ...saved, familyDiners: 0 }, context).familyDiners,
		0,
	);
	assert.equal(
		parseSavedSettings({ ...saved, familyDiners: 99 }, context).familyDiners,
		8,
	);
});

it("malformed or stale saved library settings restore each key's default", () => {
	const defaults = {
		servings: 4,
		familyDiners: 0,
		units: "us",
		filters: DEFAULT_FILTERS,
		appliancesOnHand: defaultAppliances,
		familyChoice: {},
	};
	for (const saved of [null, "settings", [], 7])
		assert.deepEqual(parseSavedSettings(saved, context), defaults);
	assert.deepEqual(
		parseSavedSettings(
			{
				servings: "lots",
				filters: {
					proteinChoice: "fish",
					starchChoice: { rice: true },
					ingredientChoice: ["hemp", "gravel"],
					mealKetoOnly: ["keto"],
					vegetarianOnly: "true",
					smoothieKetoOnly: "yes",
					ironRich: 1,
				},
				appliancesOnHand: null,
				familyChoice: "pita",
			},
			context,
		),
		{
			...defaults,
			filters: { ...DEFAULT_FILTERS, ingredientChoice: ["hemp"] },
		},
	);
	assert.deepEqual(
		parseSavedSettings(
			{
				filters: "keto",
				familyChoice: {
					"shawarma-chicken-bowls": "naan",
					"greek-turkey-patties": "bun_one",
					"no-such-recipe": "bun_one",
				},
			},
			context,
		).familyChoice,
		{ "greek-turkey-patties": "bun_one" },
		"only sides their recipe still offers survive",
	);
});

it("vegetarian preference excludes meat and unverified cheeses and survives saved settings", () => {
	const matches = data.recipes.filter(
		(recipe) =>
			recipe.type === "meal" && matchesRecipe(recipe, 4, { vegetarian: true }),
	);
	assert.deepEqual(matches.map((recipe) => recipe.id).sort(), [
		"source-basic-keto-chaffle-recipe",
	]);
	assert.equal(
		matchesRecipe(matches[0], 4, { vegetarian: true, protein: ["chicken"] }),
		false,
	);
	const saved = parseSavedSettings(
		{ filters: { vegetarianOnly: true } },
		{ recipes: data.recipes, ingredients: {} },
	);
	assert.equal(saved.filters.vegetarianOnly, true);
});

it("dump and go requires explicit audited data and keeps other filters applied", () => {
	const matches = data.recipes.filter((recipe) =>
		matchesRecipe(recipe, 4, { dumpAndGo: true }),
	);
	assert.deepEqual(matches.map((recipe) => recipe.id).sort(), [
		"source-crockpot-shredded-chicken",
		"source-keto-slow-cooker-zesty-ranch-chicken",
	]);
	assert.equal(
		matchesRecipe(matches[0], 4, { dumpAndGo: true, protein: ["fish"] }),
		false,
	);
	assert.equal(
		parseSavedSettings(
			{ filters: { dumpAndGo: "true", mealStyle: "nonketo" } },
			context,
		).filters.dumpAndGo,
		false,
	);
	assert.deepEqual(
		parseSavedSettings({ filters: { mealStyle: "nonketo" } }, context).filters,
		DEFAULT_FILTERS,
	);
});
