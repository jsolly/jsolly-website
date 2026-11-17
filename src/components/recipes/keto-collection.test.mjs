import assert from "node:assert/strict";
import { it } from "vitest";
import { archivedRecipes } from "./archived-recipes.test-data.mjs";
import { ingredientGrams } from "./ingredient-units.mjs";
import nutrition from "./nutrition-data.json" with { type: "json" };
import data from "./recipe-data.server.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";
import { dietaryClass, displayNutrition } from "./recipe-logic.mjs";

const SQUID = /squid|calamari/iu;
const OIL = /oil/iu;
const MOLLUSK = /mollusc|mollusk|squid/iu;
const NUT = /almond|tree nut/iu;
const EGG = /egg/iu;
const WHOLE_PORK_ENDPOINT = /145°F/u;
const GROUND_MEAT_ENDPOINT = /160°F/u;
const PORK_REST = /3[ -]minute/u;
const SAUSAGE_GUIDANCE = /raw pork sausage/iu;
const POTATO = /potato/iu;
const RETIRED = new Set([
	"tomato-lentil-and-chicken-bake",
	"harissa-chickpea-and-cauliflower-bowls",
	"sheet-pan-gnocchi-white-beans-and-broccoli",
	"strawberry-banana-smoothie",
	"banana-flax-smoothie",
	"chicken-posole",
	"source-one-pan-sausage-veggies",
	"carrot-cake",
]);
const ADAPTED = [
	"lemon-chicken-potatoes-and-green-beans",
	"source-low-carb-taco-casserole",
	"source-creamy-chicken-breast-in-spinach-parmesan-sauce",
	"source-creamy-tuscan-salmon-recipe",
	"source-creamy-cajun-shrimp-with-sausage",
	"source-garlic-butter-shrimp-with-lemon-parmesan-cauliflower-rice",
	"source-lemon-garlic-butter-steak-with-spinach",
	"source-easy-cajun-pork-chops-with-lemon-garlic-zucchini",
	"source-fried-cabbage-with-sausage",
	"source-italian-sausage-with-cilantro-lime-cauliflower-rice",
	"source-sausage-taco-cauliflower-rice-skillet",
	"source-one-pan-lemon-butter-chicken-with-asparagus",
	"source-italian-sausage-and-peppers-skillet",
	"source-stuffed-chicken-breast-with-mozzarella-and-spinach",
	"source-grilled-bruschetta-chicken",
];
const close = (actual, expected, label) =>
	// biome-ignore lint/suspicious/noMisplacedAssertion: shared numeric assertion called only from tests.
	assert.ok(
		Math.abs(actual - expected) < 1e-8,
		`${label}: ${actual} != ${expected}`,
	);

it("the keto collection preserves retained IDs and exports shared-table advice for every published recipe", () => {
	const expectedIds = archivedRecipes
		.filter((recipe) => !RETIRED.has(recipe.id))
		.map((recipe) => recipe.id)
		.concat("keto-fried-calamari")
		.sort();
	assert.deepEqual(data.recipes.map((recipe) => recipe.id).sort(), expectedIds);
	for (const recipe of data.recipes) {
		assert.equal(dietaryClass(recipe), "keto", recipe.id);
		assert.ok(displayNutrition(recipe).net_carbs_g <= 12.5, recipe.id);
		assert.ok(recipe.sharedTable.trim().length > 30, recipe.id);
		const document = recipeDocument(recipe);
		assert.equal(document.sharedTable, recipe.sharedTable, recipe.id);
		assert.ok(
			documentMarkdown(document).includes(document.sharedTable),
			recipe.id,
		);
		assert.equal(document.sideIngredient, null, recipe.id);
		assert.equal(document.sideDiners, 0, recipe.id);
	}
});

it("all fifteen adaptations qualify from complete ingredient sums while preserving publisher source nutrition", () => {
	for (const id of ADAPTED) {
		const recipe = data.recipes.find((candidate) => candidate.id === id);
		const original = archivedRecipes.find((candidate) => candidate.id === id);
		assert.ok(recipe, id);
		assert.ok(
			displayNutrition(original).net_carbs_g > 12.5,
			`${id}: source needed adaptation`,
		);
		const rows = nutrition.recipes[id];
		for (const key of ["kcal", "protein_g", "carbs_g", "fiber_g"]) {
			assert.ok(
				rows.every((row) => Number.isFinite(row.macros[key])),
				`${id}/${key}`,
			);
			const expected =
				rows.reduce(
					(sum, row) => sum + (row.macros[key] * row.grams) / 100,
					0,
				) / 4;
			close(recipe.nutrition[key], expected, `${id}/${key}`);
		}
		const totalNetCarbs =
			rows.reduce(
				(sum, row) =>
					sum +
					((row.macros.carbs_g -
						row.macros.fiber_g -
						(row.macros.erythritol_g ?? 0)) *
						row.grams) /
						100,
				0,
			) / 4;
		close(
			displayNutrition(recipe).net_carbs_g,
			Math.max(0, totalNetCarbs),
			`${id}/net carbs`,
		);
		assert.ok(totalNetCarbs <= 12.5, id);
		assert.deepEqual(
			recipe.sourceRecipe?.sourceNutrition,
			original.sourceRecipe?.sourceNutrition,
			id,
		);
	}
});

it("fried calamari counts squid carbohydrates and the full measured frying oil in its ingredient model", () => {
	const recipe = data.recipes.find(
		(candidate) => candidate.id === "keto-fried-calamari",
	);
	assert.ok(recipe);
	const rows = nutrition.recipes[recipe.id];
	const squid = recipe.ingredients.find((ingredient) =>
		SQUID.test(ingredient.name),
	);
	const oil = recipe.ingredients.find((ingredient) =>
		OIL.test(ingredient.name),
	);
	const squidRow = rows.find((row) => row.ingredientId === squid.id);
	const oilRow = rows.find((row) => row.ingredientId === oil.id);
	// USDA SR Legacy FDC174223 reports 3.08 g carbohydrate per 100 g raw squid.
	assert.equal(squidRow.macros.carbs_g, 3.08);
	assert.ok(oilRow.nutrients.fat > 90, "frying oil contributes observed fat");
	close(
		oilRow.grams,
		ingredientGrams(oil),
		"all measured shallow-frying oil is counted",
	);
	const fat =
		rows.reduce((sum, row) => sum + (row.nutrients.fat * row.grams) / 100, 0) /
		4;
	close(displayNutrition(recipe).fat_g, fat, "calamari total fat");
	assert.ok(recipe.allergens.some((allergen) => MOLLUSK.test(allergen)));
	assert.ok(recipe.allergens.some((allergen) => NUT.test(allergen)));
	assert.ok(recipe.allergens.some((allergen) => EGG.test(allergen)));
	assert.equal(dietaryClass(recipe), "keto");
});

it("lemon chicken keeps potatoes outside the base and scales its side to two of four diners", () => {
	const recipe = data.recipes.find(
		(candidate) => candidate.id === "lemon-chicken-potatoes-and-green-beans",
	);
	const original = archivedRecipes.find(
		(candidate) => candidate.id === recipe.id,
	);
	assert.ok(
		!recipe.ingredients.some((ingredient) => POTATO.test(ingredient.name)),
	);
	const chicken = recipe.ingredients.find(
		(ingredient) => ingredient.id === "chicken_thigh",
	);
	const originalChicken = original.ingredients.find(
		(ingredient) => ingredient.id === chicken.id,
	);
	close(
		ingredientGrams(chicken),
		ingredientGrams(originalChicken),
		"chicken portion is retained",
	);
	const potato = recipe.familyOptions.find((side) =>
		POTATO.test(side.ingredientName),
	);
	assert.ok(potato);
	const document = recipeDocument(recipe, {
		servings: 4,
		units: "grams",
		familyDiners: 2,
		familyChoice: { [recipe.id]: potato.id },
	});
	assert.equal(document.sideDiners, 2);
	close(
		document.sideIngredient.grams,
		ingredientGrams(potato) * 2,
		"two potato portions",
	);
	close(
		document.nutrition.net_carbs_g,
		recipeDocument(recipe).nutrition.net_carbs_g,
		"side excluded from base macros",
	);
	assert.ok(document.sideNutritionPerDiner.net_carbs_g > 0);
});

it("reviewed preparation distinguishes whole pork cuts from raw sausage and ground beef", () => {
	for (const id of [
		"source-easy-cajun-pork-chops-with-lemon-garlic-zucchini",
		"source-garlic-butter-pork-with-lemon-asparagus",
	]) {
		const recipe = data.recipes.find((candidate) => candidate.id === id);
		const preparation = recipe.flow.prep.join(" ");
		assert.match(preparation, WHOLE_PORK_ENDPOINT, id);
		assert.match(preparation, PORK_REST, id);
		assert.doesNotMatch(preparation, SAUSAGE_GUIDANCE, id);
	}
	for (const id of ["source-zuppa-toscana", "source-low-carb-taco-casserole"]) {
		const recipe = data.recipes.find((candidate) => candidate.id === id);
		const preparation = recipe.flow.prep.join(" ");
		assert.match(preparation, GROUND_MEAT_ENDPOINT, id);
		assert.doesNotMatch(preparation, WHOLE_PORK_ENDPOINT, id);
	}
});
