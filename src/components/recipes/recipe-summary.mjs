import {
	applianceChoices,
	BASE_SERVINGS,
	defaultAppliances,
	dietaryLabels,
	nutritionHighlights,
	proteins,
	starchOptions,
} from "./constants.mjs";
import {
	matchesRecipe,
	nutrientFilters,
	smoothieIngredientChoices,
} from "./nutrient-filters.mjs";
import {
	browseFilterSettings,
	paginateBrowseRecipes,
} from "./recipe-browse.mjs";
import {
	dietaryClass,
	servingNutrition,
	smoothiePortionNutrition,
} from "./recipe-logic.mjs";

/** Explicit card boundary: no ingredients, cooking method or calculation tables. */
export function recipeCardSummary(recipe, servings = BASE_SERVINGS) {
	const dietary = dietaryClass(recipe);
	const flags = nutrientFilters(recipe, servings);
	return {
		id: recipe.id,
		type: recipe.type,
		title: recipe.title,
		image: recipe.image
			? {
					cardSrc: recipe.image.cardSrc,
					cardSrcset: recipe.image.cardSrcset,
					width: recipe.image.width,
					height: recipe.image.height,
					alt: recipe.image.alt,
				}
			: null,
		activeMinutes: recipe.activeMinutes,
		sourceRecipe: Boolean(recipe.sourceRecipe),
		appliancesNeeded: recipe.appliancesNeeded,
		familyOptions: recipe.familyOptions.map(({ id }) => ({ id })),
		netCarbs: (recipe.type === "smoothie"
			? smoothiePortionNutrition(recipe)
			: servingNutrition(recipe, BASE_SERVINGS)
		).net_carbs_g,
		nutritionPills: Object.entries(nutritionHighlights)
			.filter(([key]) => flags[key])
			.map(([key, { label, description }]) => ({ key, label, description })),
		dietaryPills: [{ key: dietary, label: dietaryLabels[dietary] }],
	};
}

/** Availability describes adding/removing one option under the current collection filters. */
export function browseFilterChoices(recipes, collection, state) {
	const collectionRecipes = recipes.filter(
		(recipe) => recipe.type === collection,
	);
	const current = browseFilterSettings(recipes, collection, state);
	const hasMatches = (override) =>
		collectionRecipes.some((recipe) =>
			matchesRecipe(recipe, state.settings.servings, {
				...current,
				...override,
			}),
		);
	const smoothieIngredients = smoothieIngredientChoices(recipes);
	const options = (key, filter, choices) =>
		Object.fromEntries(
			Object.keys(choices).map((value) => {
				const selected = state.settings.filters[key];
				const toggled = selected.includes(value)
					? selected.filter((item) => item !== value)
					: [...selected, value];
				return [value, hasMatches({ [filter]: toggled })];
			}),
		);
	return {
		matchesDefaultInventory: hasMatches({ appliances: defaultAppliances }),
		proteinChoice: options("proteinChoice", "protein", proteins),
		starchChoice: options("starchChoice", "starch", starchOptions),
		ingredientChoice: options(
			"ingredientChoice",
			"ingredients",
			smoothieIngredients,
		),
		flags: {
			vegetarianOnly: hasMatches({ vegetarian: true }),
			dumpAndGo: hasMatches({ dumpAndGo: true }),
			immuneSupport: hasMatches({ immune: true }),
			ironRich: hasMatches({ iron: true }),
			omega3: hasMatches({ omega: true }),
		},
		shownAppliances: Object.keys(applianceChoices).filter((key) =>
			collectionRecipes.some((recipe) => recipe.appliancesNeeded.includes(key)),
		),
		smoothieIngredients,
		collectionHasIron: collectionRecipes.some(
			(recipe) => nutrientFilters(recipe, state.settings.servings).iron,
		),
	};
}

export function createBrowsePage(
	recipes,
	collection,
	state,
	release,
	page = state.page ?? 1,
) {
	const result = paginateBrowseRecipes(recipes, collection, { ...state, page });
	return {
		release,
		cards: result.recipes.map((recipe) =>
			recipeCardSummary(recipe, state.settings.servings),
		),
		total: result.total,
		page: result.page,
		nextPage: result.nextPage,
		seed: state.seed,
		filterChoices: browseFilterChoices(recipes, collection, state),
	};
}
