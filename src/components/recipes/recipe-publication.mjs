import { KETO_NET_CARBS_MAX } from "./constants.mjs";
import { displayNutrition } from "./recipe-logic.mjs";
import retired from "./retired-recipes.json" with { type: "json" };

const retiredIds = new Set(retired.map(({ id }) => id));

/** Stored older recipes keep their own nutrition and never inherit a revised label. */
export function isKetoSavedRecipe(record) {
	const recipe = record?.recipe;
	if (
		!recipe ||
		typeof recipe.id !== "string" ||
		!["meal", "smoothie"].includes(recipe.type) ||
		retiredIds.has(recipe.id)
	)
		return false;
	try {
		const netCarbs = displayNutrition(recipe).net_carbs_g;
		return Number.isFinite(netCarbs) && netCarbs <= KETO_NET_CARBS_MAX;
	} catch {
		// Unknown historical pack formats remain stored, outside current browsing.
		return false;
	}
}

/** Fail the build instead of quietly publishing an incomplete or non-keto dish. */
export function requirePublishedRecipe(recipe) {
	if (retiredIds.has(recipe.id))
		throw new Error(`${recipe.id}: retired recipe cannot be published`);
	if (!isKetoSavedRecipe({ recipe }))
		throw new Error(`${recipe.id}: published recipe must qualify as keto`);
	if (typeof recipe.sharedTable !== "string" || !recipe.sharedTable.trim())
		throw new Error(
			`${recipe.id}: published recipe needs shared-table guidance`,
		);
	return recipe;
}

/** Known legacy fragments have an explicit notice at their original recipe URL. */
export function retiredRecipePath(id) {
	return retiredIds.has(id) ? `/recipes/${id}/` : null;
}

export function retirementMarkdown(recipe) {
	const collection = recipe.type === "smoothie" ? "smoothies" : "meals";
	return [
		`# ${recipe.title}`,
		"",
		"This recipe is no longer in the keto collection because its original version exceeds the collection's carbohydrate limit.",
		"",
		"Choose a keto recipe from the links below.",
		"",
		...(recipe.replacementId
			? [
					`[Try a keto alternative](https://www.jsolly.com/recipes/${recipe.replacementId}/).`,
					"",
				]
			: []),
		`[Browse keto ${collection}](https://www.jsolly.com/recipes/${collection}/).`,
		"",
	].join("\n");
}
