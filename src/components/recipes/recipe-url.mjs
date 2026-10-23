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

// The shareable link to a recipe page with the reader's servings and optional side.
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

// Default browsing links point directly to the canonical page. Shared links
// still carry explicit defaults so they override a recipient's preferences.
export function recipeBrowseHref(recipe, settings) {
	const { servings, units } = validateSettings(settings);
	const side = settings.familyChoice?.[recipe.id];
	const hasSide = recipe.familyOptions.some((option) => option.id === side);
	return servings === BASE_SERVINGS && units === "us" && !hasSide
		? `/recipes/${recipe.id}/`
		: recipeHref(recipe, settings);
}

// A recipe page's own URL after a units or side change: units always, the
// selected side as ?starch=, and servings only when not the default. Keeping
// every explicit choice in the URL means a reload restores all of them.
export function recipePageURL(url, recipe, settings) {
	const next = new URL(url);
	const { servings, units } = validateSettings(settings);
	if (servings === BASE_SERVINGS) next.searchParams.delete("servings");
	else next.searchParams.set("servings", String(servings));
	next.searchParams.set("units", units);
	const side = settings.familyChoice?.[recipe.id];
	if (recipe.familyOptions.some((option) => option.id === side))
		next.searchParams.set("starch", `${recipe.id}:${side}`);
	else next.searchParams.delete("starch");
	return next;
}
