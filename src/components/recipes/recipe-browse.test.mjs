import assert from "node:assert/strict";
import { it } from "vitest";
import { defaultAppliances } from "./constants.mjs";
import {
	matchesRecipe,
	smoothieIngredientChoices,
} from "./nutrient-filters.mjs";
import {
	browseFormValues,
	filterBrowseRecipes,
	paginateBrowseRecipes,
	parseBrowseParams,
} from "./recipe-browse.mjs";
import data from "./recipe-data.server.mjs";

const recipes = data.recipes;
const parse = (query, collection = "meal") =>
	parseBrowseParams(new URLSearchParams(query), collection, recipes);

it("native browse defaults and malformed values use domain defaults and bounded text", () => {
	const defaults = parse("");
	assert.equal(defaults.settings.servings, 4);
	assert.equal(defaults.settings.units, "us");
	assert.deepEqual(defaults.settings.appliancesOnHand, defaultAppliances);
	const state = parse(
		`servings=99&units=invalid&mealStyle=other&proteinChoice=fish&proteinChoice=fish&proteinChoice=bogus&appliance.Instant+Pot=999&omega3=true&seed=%3Cscript%3E&q=${"a".repeat(500)}`,
	);
	assert.equal(state.settings.servings, 4);
	assert.equal(state.settings.units, "us");
	assert.deepEqual(state.settings.filters.proteinChoice, ["fish"]);
	assert.equal(state.settings.filters.omega3, false);
	assert.equal(state.settings.appliancesOnHand["Instant Pot"], 1);
	assert.equal(state.query.length, 200);
	assert.equal(state.seed, "");
});

it("native browse matches hydrated meal protein, starch, style, flags and inventory semantics", () => {
	for (const query of [
		"proteinChoice=fish&proteinChoice=chicken",
		"starchChoice=rice",
		"vegetarianOnly=1",
		"mealKetoOnly=1",
		// biome-ignore lint/security/noSecrets: public dietary filter query
		"mealKetoOnly=1&vegetarianOnly=1",
		"dumpAndGo=1",
		"immuneSupport=1",
		"ironRich=1",
		"omega3=1",
		// biome-ignore lint/security/noSecrets: public appliance query fixture
		"appliance.Two+air+fryers=1",
		"appliance.Oven=0",
		// biome-ignore lint/security/noSecrets: public servings query fixture
		"servings=2&ironRich=1",
	]) {
		const state = parse(query);
		const { filters: f, servings, appliancesOnHand } = state.settings;
		const expected = recipes.filter(
			(r) =>
				r.type === "meal" &&
				matchesRecipe(r, servings, {
					protein: f.proteinChoice,
					starch: f.starchChoice,
					vegetarian: f.vegetarianOnly,
					carb: f.mealKetoOnly ? ["keto"] : [],
					dumpAndGo: f.dumpAndGo,
					immune: f.immuneSupport,
					iron: f.ironRich,
					omega: f.omega3,
					appliances: appliancesOnHand,
				}),
		);
		assert.deepEqual(
			filterBrowseRecipes(recipes, "meal", state),
			expected,
			query,
		);
	}
});

it("native smoothie ingredients use OR and collection-specific keto filters", () => {
	const choices = Object.keys(smoothieIngredientChoices(recipes)).slice(0, 2);
	const state = parse(
		`ingredientChoice=${choices[0]}&ingredientChoice=${choices[1]}&smoothieKetoOnly=1&proteinChoice=fish`,
		"smoothie",
	);
	const expected = recipes.filter(
		(r) =>
			r.type === "smoothie" &&
			matchesRecipe(r, 4, { ingredients: choices, carb: ["keto"] }),
	);
	assert.deepEqual(filterBrowseRecipes(recipes, "smoothie", state), expected);
});

it("native search narrows results and seeded shuffle preserves matches deterministically", () => {
	const state = parse("q=salmon&seed=sample-123");
	const first = filterBrowseRecipes(recipes, "meal", state);
	assert.ok(first.length > 0 && first.length < 140);
	assert.deepEqual(first, filterBrowseRecipes(recipes, "meal", state));
	assert.deepEqual(
		first.map((r) => r.id).sort(),
		filterBrowseRecipes(recipes, "meal", { ...state, seed: "" })
			.map((r) => r.id)
			.sort(),
	);
	assert.equal(
		filterBrowseRecipes(recipes, "meal", parse("q=zzzzzzzzzzzzzzzz")).length,
		0,
	);
});

it("native form restoration roundtrips flags, selections, units, portions and zero appliance counts", () => {
	const state = parse(
		// biome-ignore lint/security/noSecrets: public filter query fixture
		"mealKetoOnly=1&vegetarianOnly=1&servings=8&units=grams&proteinChoice=fish&omega3=1&appliance.Oven=0&q=salmon&seed=abc",
	);
	const params = new URLSearchParams();
	for (const [name, values] of Object.entries(browseFormValues(state, "meal")))
		for (const value of values) params.append(name, value);
	assert.deepEqual(parseBrowseParams(params, "meal", recipes), state);
	assert.equal(params.get("appliance.Oven"), "0");
	assert.equal(params.get("browse"), "1");
});

it("browse pagination uses six cards, clamps invalid and empty pages, and preserves seeded order", () => {
	for (const value of ["0", "-1", "1.5", "NaN", "99999999999"])
		assert.equal(parse(`page=${value}`).page, 1);
	const state = parse("seed=page-test");
	const expected = filterBrowseRecipes(recipes, "meal", state).map(
		(recipe) => recipe.id,
	);
	const visited = [];
	let page = 1;
	do {
		const result = paginateBrowseRecipes(recipes, "meal", { ...state, page });
		assert.ok(result.recipes.length <= 6);
		assert.equal(result.total, expected.length);
		visited.push(...result.recipes.map((recipe) => recipe.id));
		page = result.nextPage;
	} while (page !== null);
	assert.deepEqual(visited, expected);
	assert.equal(new Set(visited).size, expected.length);
	const last = paginateBrowseRecipes(recipes, "meal", { ...state, page: 9999 });
	assert.equal(last.page, Math.ceil(expected.length / 6));
	assert.equal(last.nextPage, null);
	const empty = paginateBrowseRecipes(
		recipes,
		"meal",
		// biome-ignore lint/security/noSecrets: public empty-result pagination query
		parse("q=zzzznomatch&page=999"),
	);
	assert.equal(empty.page, 1);
	assert.equal(empty.nextPage, null);
	assert.equal(empty.total, 0);
});

it("a shuffle seed preserves global relative ordering through search and filter subsets", () => {
	const state = parse("seed=stable-global-order");
	const ordered = filterBrowseRecipes(recipes, "meal", state).map(
		(recipe) => recipe.id,
	);
	const narrowed = filterBrowseRecipes(recipes, "meal", {
		...state,
		query: "chicken",
	}).map((recipe) => recipe.id);
	const subset = new Set(narrowed);
	assert.ok(narrowed.length > 1 && narrowed.length < ordered.length);
	assert.deepEqual(
		narrowed,
		ordered.filter((id) => subset.has(id)),
	);
	assert.deepEqual(
		filterBrowseRecipes(recipes, "meal", { ...state, query: "" }).map(
			(recipe) => recipe.id,
		),
		ordered,
	);
});
