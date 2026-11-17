import { BASE_SERVINGS } from "./constants.mjs";
import { servingNutrition, smoothiePortionNutrition } from "./recipe-logic.mjs";
import { formatNutrition } from "./recipe-settings.mjs";

/**
 * The static catalog uses the same base-portion nutrition as library cards.
 * @returns {Array<{type: string, title: string, href: string, recipes: Array<{id: string, title: string, href: string, timeLabel: string, time: string, netCarbs: string}>}>}
 */
export function recipeCatalog(recipes) {
	return [
		{ type: "meal", title: "Keto meals", href: "/recipes/meals/" },
		{ type: "smoothie", title: "Keto smoothies", href: "/recipes/smoothies/" },
	].map((collection) => ({
		...collection,
		recipes: recipes
			.filter(({ type }) => type === collection.type)
			.map((recipe) => ({
				id: recipe.id,
				title: recipe.title,
				href: `/recipes/${recipe.id}/`,
				timeLabel: recipe.sourceRecipe ? "Prep time" : "Active time",
				time:
					recipe.activeMinutes === null
						? "Not provided"
						: `${recipe.activeMinutes} min`,
				netCarbs: formatNutrition(
					(recipe.type === "smoothie"
						? smoothiePortionNutrition(recipe)
						: servingNutrition(recipe, BASE_SERVINGS)
					).net_carbs_g,
					"g",
				),
			})),
	}));
}

export function recipeCatalogItemList(collections, site) {
	return {
		"@context": "https://schema.org",
		"@type": "ItemList",
		"@id": new URL("/recipes/all/#recipes", site).href,
		name: "All keto recipes",
		itemListElement: collections
			.flatMap(({ recipes }) => recipes)
			.map((recipe, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: new URL(recipe.href, site).href,
			})),
	};
}
