import {
	applianceChoices,
	applianceLimits,
	applianceNeeds,
	carbStyles,
	DEFAULT_FILTERS,
	defaultAppliances,
	proteins,
	starchOptions,
} from "./constants.mjs";
import { dailyNutrition, recordedOmega3 } from "./nutrition.mjs";
import { ingredientAmount, validateSettings } from "./recipe-logic.mjs";

const immuneNutrients = new Set([
	"vitamin_a",
	"vitamin_c",
	"vitamin_d",
	"zinc",
	"selenium",
]);
export function nutrientFilters(recipe, servings) {
	const nutrients = dailyNutrition(recipe, servings, ingredientAmount);
	const rich = (n) => n.amount !== null && n.amount / n.dailyValue >= 0.2;
	return {
		immune:
			nutrients.filter((n) => immuneNutrients.has(n.key) && rich(n)).length >=
			2,
		iron: nutrients.some((n) => n.key === "iron" && rich(n)),
		omega: recordedOmega3(recipe, servings, ingredientAmount) >= 0.5,
	};
}

// Omit shared bases such as water and yogurt; the remaining ingredients distinguish smoothies.
export function smoothieIngredientChoices(recipes) {
	const smoothies = recipes.filter((recipe) => recipe.type === "smoothie");
	const ingredients = new Map();
	for (const recipe of smoothies)
		for (const ingredient of recipe.ingredients) {
			const entry = ingredients.get(ingredient.id) || {
				name: ingredient.name,
				count: 0,
			};
			ingredients.set(ingredient.id, { ...entry, count: entry.count + 1 });
		}
	return Object.fromEntries(
		[...ingredients]
			.filter(([, entry]) => entry.count < smoothies.length)
			.sort((a, b) => a[1].name.localeCompare(b[1].name))
			.map(([id, entry]) => [id, entry.name]),
	);
}
// Saved multi-select filters are arrays of option keys; anything else
// restores as no selection.
export function normalizeSelection(value, options) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item) => Object.hasOwn(options, item)))];
}
// An empty selection matches every value.
function selectedMatches(selection, value) {
	return !selection.length || selection.includes(value);
}
// A choice is unavailable when it is not picked and picking it would leave
// no recipe (`wouldMatch` says whether any would remain).
export function choiceUnavailable(picked, wouldMatch) {
	return !picked && !wouldMatch();
}
// Saved appliance counts, clamped per appliance; a missing or invalid count
// restores its default.
export function availableAppliances(value) {
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.keys(applianceChoices).map((key) => [
				key,
				Math.max(
					0,
					Math.min(
						applianceLimits[key] ?? 1,
						Number.isInteger(value[key]) ? value[key] : defaultAppliances[key],
					),
				),
			]),
		);
	return { ...defaultAppliances };
}
export function hasAppliances(recipe, inventory) {
	return recipe.appliancesNeeded.every(
		(key) => (inventory[key] || 0) >= (applianceNeeds[key] ?? 1),
	);
}
export function matchesRecipe(
	recipe,
	servings,
	{
		protein = [],
		carb = [],
		starch = [],
		immune = false,
		iron = false,
		omega = false,
		ingredients = [],
		appliances = defaultAppliances,
	} = {},
) {
	const flags = nutrientFilters(recipe, servings);
	return (
		(!ingredients.length ||
			recipe.ingredients.some((ingredient) =>
				ingredients.includes(ingredient.id),
			)) &&
		hasAppliances(recipe, appliances) &&
		selectedMatches(protein, recipe.proteinType) &&
		selectedMatches(carb, recipe.group) &&
		(!starch.length || starch.some((type) => recipe.starches.includes(type))) &&
		(!immune || flags.immune) &&
		(!iron || flags.iron) &&
		(!omega || flags.omega)
	);
}

const isObject = (value) =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The library's saved settings (localStorage recipes-settings-v1), validated
// key by key: anything missing, of the wrong shape or no longer offered
// restores its default. `recipes` are the library's recipes (a family side
// must still be one of its recipe's sides) and `ingredients` the smoothie
// ingredient choices.
export function parseSavedSettings(saved, { recipes, ingredients }) {
	const settings = isObject(saved) ? saved : {};
	const filters = isObject(settings.filters) ? settings.filters : {};
	const familyChoice = isObject(settings.familyChoice)
		? Object.fromEntries(
				Object.entries(settings.familyChoice).filter(([id, side]) =>
					recipes
						.find((recipe) => recipe.id === id)
						?.familyOptions.some((option) => option.id === side),
				),
			)
		: {};
	const flag = (key) => filters[key] === true;
	return {
		servings: validateSettings({ servings: settings.servings }).servings,
		units: validateSettings({ units: settings.units }).units,
		filters: {
			...DEFAULT_FILTERS,
			proteinChoice: normalizeSelection(filters.proteinChoice, proteins),
			starchChoice: normalizeSelection(filters.starchChoice, starchOptions),
			ingredientChoice: normalizeSelection(
				filters.ingredientChoice,
				ingredients,
			),
			mealStyle:
				typeof filters.mealStyle === "string" &&
				Object.hasOwn(carbStyles, filters.mealStyle)
					? filters.mealStyle
					: DEFAULT_FILTERS.mealStyle,
			smoothieKetoOnly: flag("smoothieKetoOnly"),
			immuneSupport: flag("immuneSupport"),
			ironRich: flag("ironRich"),
			omega3: flag("omega3"),
		},
		appliancesOnHand: availableAppliances(settings.appliancesOnHand),
		familyChoice,
	};
}
