import MiniSearch from "minisearch";
import {
	applianceChoices,
	BASE_SERVINGS,
	dietaryLabels,
	nutritionHighlights,
	proteins,
	starchTypes,
} from "./constants.mjs";
import { nutrientFilters } from "./nutrient-filters.mjs";
import { dietaryClass } from "./recipe-logic.mjs";

// Index cooking content, including nested steps and family sides, without
// exposing internal IDs, image paths or provenance URLs as search terms.
function text(value) {
	if (typeof value === "string") return value.replace(/https?:\/\/\S+/gu, "");
	if (Array.isArray(value)) return value.map(text).join(" ");
	if (!value || typeof value !== "object") return "";
	return Object.entries(value)
		.filter(([key]) => !["id", "ingredientId", "url"].includes(key))
		.map(([, child]) => text(child))
		.join(" ");
}

export function createRecipeSearch(recipes, servings = BASE_SERVINGS) {
	const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
	const index = new MiniSearch({
		fields: ["title", "ingredients", "details"],
		processTerm: (term) =>
			term.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""),
		searchOptions: {
			boost: { title: 8, ingredients: 4 },
			combineWith: "AND",
			prefix: (term) => term.length >= 2,
			fuzzy: (term) => (term.length >= 5 ? 0.25 : false),
			maxFuzzy: 2,
		},
	});
	index.addAll(
		recipes.map((recipe) => ({
			id: recipe.id,
			title: recipe.title,
			ingredients: text(recipe.ingredients),
			details: text([
				recipe.summary,
				recipe.sharedTable,
				recipe.steps,
				recipe.equipment,
				recipe.timeline,
				recipe.tips,
				recipe.fallback,
				recipe.limitations,
				recipe.familyOptions,
				recipe.attentionSummary,
				recipe.flavorRationale,
				recipe.flow,
				recipe.capacity,
				recipe.timingNote,
				recipe.safety,
				recipe.allergens,
				recipe.boosters,
				recipe.sourceRecipe?.author,
				Object.entries(nutrientFilters(recipe, servings))
					.filter(([, matches]) => matches)
					.map(([key]) => nutritionHighlights[key]?.label),
				dietaryLabels[dietaryClass(recipe)],
				proteins[recipe.proteinType],
				recipe.appliancesNeeded.map((name) => applianceChoices[name]),
				recipe.starches.map((name) => starchTypes[name]),
			]),
		})),
	);
	return (query) =>
		!query.trim() ? recipes : index.search(query).map(({ id }) => byId.get(id));
}
