import { BASE_SERVINGS } from "./constants.mjs";
import { validateSettings } from "./recipe-logic.mjs";

// Reads a recipe link's settings: ?servings=, ?starch=<id>:<side>[,…] and the
// recipe it names (its /recipes/<id>/ page or a #<id> hash).
export function readRecipeURL(
	url,
	recipes,
	defaults = { servings: BASE_SERVINGS },
) {
	const servings = validateSettings({
		servings: url.searchParams.has("servings")
			? Number(url.searchParams.get("servings"))
			: defaults.servings,
	}).servings;
	const units = validateSettings({
		units: url.searchParams.has("units")
			? url.searchParams.get("units")
			: defaults.units,
	}).units;
	const familyChoice = {};
	for (const part of (url.searchParams.get("starch") || "").split(",")) {
		const [id, side] = part.split(":");
		if (
			recipes
				.find((recipe) => recipe.id === id)
				?.familyOptions.some((option) => option.id === side)
		)
			familyChoice[id] = side;
	}
	const recipeId =
		recipes.find(
			(recipe) =>
				url.pathname === `/recipes/${recipe.id}/` ||
				url.hash === `#${recipe.id}`,
		)?.id || "";
	return { servings, units, familyChoice, recipeId };
}

// The shareable link to a recipe page with the reader's servings and family side.
export function recipeHref(recipe, settings) {
	const params = new URLSearchParams({
		servings: String(validateSettings(settings).servings),
		units: validateSettings(settings).units,
	});
	const side = settings.familyChoice?.[recipe.id];
	if (recipe.familyOptions.some((option) => option.id === side))
		params.set("starch", `${recipe.id}:${side}`);
	return `/recipes/${recipe.id}/?${params}`;
}
