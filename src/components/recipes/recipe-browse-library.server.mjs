import { SERVING_CHOICES } from "./constants.mjs";
import { nutrientFilters } from "./nutrient-filters.mjs";
import { buildRecipeSearchIndex } from "./recipe-search.mjs";
import { recipeCardSummary } from "./recipe-summary.mjs";

/** Build-only projection. Cooking instructions and nutrient rows stay in detail packs. */
export function buildBrowseLibrary(recipes, release) {
	return {
		schemaVersion: 1,
		release,
		recipes: recipes.map((recipe) => ({
			id: recipe.id,
			type: recipe.type,
			proteinType: recipe.proteinType,
			vegetarian: recipe.vegetarian === true,
			dumpAndGo: recipe.dumpAndGo === true,
			starches: recipe.starches,
			appliancesNeeded: recipe.appliancesNeeded,
			ingredients: recipe.ingredients.map(({ id, name }) => ({ id, name })),
			familyOptions: recipe.familyOptions.map(({ id }) => ({ id })),
			browse: {
				card: recipeCardSummary(recipe),
				flags: Object.fromEntries(
					SERVING_CHOICES.map((servings) => [
						servings,
						nutrientFilters(recipe, servings),
					]),
				),
			},
		})),
	};
}

/** Search is optional and downloaded only for a nonempty query. */
export function buildBrowseSearch(recipes, release) {
	const indexes = [];
	const searchIndexes = {};
	const serialized = [];
	for (const servings of SERVING_CHOICES) {
		const index = buildRecipeSearchIndex(recipes, servings).toJSON();
		const json = JSON.stringify(index);
		let position = serialized.indexOf(json);
		if (position === -1) {
			position = indexes.length;
			indexes.push(index);
			serialized.push(json);
		}
		searchIndexes[servings] = position;
	}
	return { schemaVersion: 1, release, indexes, searchIndexes };
}
