import { applianceChoices } from "./constants.mjs";
import {
	matchesRecipe,
	nutrientFilters,
	parseSavedSettings,
	smoothieIngredientChoices,
} from "./nutrient-filters.mjs";
import { shuffleRecipes } from "./recipe-logic.mjs";
import { createRecipeSearch } from "./recipe-search.mjs";

const COUNT = /^\d{1,2}$/u;
const SEED = /^[a-zA-Z0-9-]{1,64}$/u;
const selections = ["proteinChoice", "starchChoice", "ingredientChoice"];
const flags = [
	"mealKetoOnly",
	"vegetarianOnly",
	"smoothieKetoOnly",
	"immuneSupport",
	"ironRich",
	"omega3",
	"dumpAndGo",
];
/** GET contract: repeated selection keys; flags=1; servings, units,
 * q (maximum 200 characters), seed (maximum 64 alphanumeric/hyphen characters),
 * appliance.<canonical appliance key>=integer. browse=1 opts into server rendering;
 * shuffle=1 requests a fresh seed from the request handler. */
export function parseBrowseParams(params, _collection, recipes) {
	const filters = Object.fromEntries(
		selections.map((key) => [key, params.getAll(key).slice(0, 100)]),
	);
	for (const key of flags) filters[key] = params.get(key) === "1";
	const appliancesOnHand = Object.fromEntries(
		Object.keys(applianceChoices).map((key) => {
			const value = params.get(`appliance.${key}`);
			return [
				key,
				value !== null && COUNT.test(value) ? Number(value) : undefined,
			];
		}),
	);
	const settings = parseSavedSettings(
		{
			servings: params.get("servings"),
			units: params.get("units"),
			filters,
			appliancesOnHand,
		},
		{ recipes, ingredients: smoothieIngredientChoices(recipes) },
	);
	const seed = params.get("seed") ?? "";
	return {
		settings,
		query: (params.get("q") ?? "").slice(0, 200),
		seed: SEED.test(seed) ? seed : "",
	};
}

/** The same collection-specific mapping as RecipeLibrary's hydrated controls. */
export function browseFilterSettings(recipes, collection, { settings }) {
	const { filters, servings, appliancesOnHand } = settings;
	return {
		protein: collection === "meal" ? filters.proteinChoice : [],
		carb:
			collection === "smoothie"
				? filters.smoothieKetoOnly
					? ["keto"]
					: []
				: filters.mealKetoOnly
					? ["keto"]
					: [],
		vegetarian: collection === "meal" && filters.vegetarianOnly,
		dumpAndGo: collection === "meal" && filters.dumpAndGo,
		starch: collection === "meal" ? filters.starchChoice : [],
		ingredients: collection === "smoothie" ? filters.ingredientChoice : [],
		immune: filters.immuneSupport,
		iron:
			filters.ironRich &&
			recipes.some(
				(recipe) =>
					recipe.type === collection && nutrientFilters(recipe, servings).iron,
			),
		omega: filters.omega3,
		appliances: appliancesOnHand,
	};
}

export function filterBrowseRecipes(recipes, collection, state) {
	const filters = browseFilterSettings(recipes, collection, state);
	const searched = state.query.trim()
		? createRecipeSearch(recipes, state.settings.servings)(state.query)
		: recipes;
	const matches = searched.filter(
		(recipe) =>
			recipe.type === collection &&
			matchesRecipe(recipe, state.settings.servings, filters),
	);
	if (!state.seed) return matches;
	let hash = 2166136261;
	for (const character of state.seed)
		hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
	return shuffleRecipes(matches, () => {
		hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
		return hash / 4294967296;
	});
}

/** Selected values for server-side native form restoration after a GET. */
export function browseFormValues({ settings, query, seed }, _collection) {
	const values = {
		browse: ["1"],
		q: [query],
		seed: [seed],
		servings: [String(settings.servings)],
		units: [settings.units],
	};
	for (const key of selections) values[key] = settings.filters[key];
	for (const key of flags) values[key] = settings.filters[key] ? ["1"] : [];
	for (const key of Object.keys(applianceChoices))
		values[`appliance.${key}`] = [String(settings.appliancesOnHand[key])];
	return values;
}
