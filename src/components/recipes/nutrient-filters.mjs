import { applianceNeeds, defaultAppliances } from "./constants.mjs";
import { dailyNutrition, recordedOmega3 } from "./nutrition.mjs";
import { ingredientAmount } from "./recipe-logic.mjs";

const immuneNutrients = new Set([
	"vitamin_a",
	"vitamin_c",
	"vitamin_d",
	"zinc",
	"selenium",
]);
export function nutrientFilters(recipe, servings) {
	if (recipe.browse) return recipe.browse.flags[servings];
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

// An empty selection matches every value.
function selectedMatches(selection, value) {
	return !selection.length || selection.includes(value);
}
// A choice is unavailable when it is not picked and picking it would leave
// no recipe (`wouldMatch` says whether any would remain).

// Saved appliance counts, clamped per appliance; a missing or invalid count
// restores its default.

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
		vegetarian = false,
		dumpAndGo = false,
		starch = [],
		immune = false,
		iron = false,
		omega = false,
		ingredients = [],
		appliances = defaultAppliances,
	} = {},
) {
	if (
		!(
			(!ingredients.length ||
				recipe.ingredients.some((ingredient) =>
					ingredients.includes(ingredient.id),
				)) &&
			hasAppliances(recipe, appliances) &&
			selectedMatches(protein, recipe.proteinType) &&
			(!vegetarian || recipe.vegetarian === true) &&
			(!dumpAndGo || recipe.dumpAndGo === true) &&
			(!starch.length || starch.some((type) => recipe.starches.includes(type)))
		)
	)
		return false;
	if (!(immune || iron || omega)) return true;
	const flags = nutrientFilters(recipe, servings);
	return (
		(!immune || flags.immune) &&
		(!iron || flags.iron) &&
		(!omega || flags.omega)
	);
}
