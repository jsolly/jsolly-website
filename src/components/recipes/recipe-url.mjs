import { BASE_SERVINGS } from "./constants.mjs";
import { validateSettings } from "./recipe-settings.mjs";
import retired from "./retired-recipes.json" with { type: "json" };

// Reads a recipe link's settings and target (its /recipes/<id>/ page or
// #<id> hash). Explicit settings override the addressed recipe's saved side,
// including older shares that represent None by omitting starch.
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
	const recipeId =
		recipes.find(
			(recipe) =>
				url.pathname === `/recipes/${recipe.id}/` ||
				url.hash === `#${recipe.id}`,
		)?.id || "";
	const offered = (id, side) =>
		recipes
			.find((recipe) => recipe.id === id)
			?.familyOptions.some((option) => option.id === side);
	const explicitSettings = ["servings", "units", "starch", "sideDiners"].some(
		(key) => url.searchParams.has(key),
	);
	const familyChoice = Object.fromEntries(
		Object.entries(defaults.familyChoice || {}).filter(
			([id, side]) =>
				offered(id, side) && !(explicitSettings && id === recipeId),
		),
	);
	let explicitSide = false;
	for (const part of (url.searchParams.get("starch") || "").split(",")) {
		const [id, side] = part.split(":");
		if (offered(id, side)) {
			familyChoice[id] = side;
			explicitSide = true;
		}
	}
	// Old links selected a side for every diner. New shared links carry an
	// explicit count, while an ordinary visit can retain the saved preference.
	const familyDiners = validateSettings({
		servings,
		familyDiners: url.searchParams.has("sideDiners")
			? url.searchParams.get("sideDiners")
			: explicitSide
				? servings
				: defaults.familyDiners,
	}).familyDiners;
	return { servings, units, familyDiners, familyChoice, recipeId };
}

// The shareable link to a recipe page with the reader's servings and optional side.
export function recipeHref(recipe, settings) {
	const params = new URLSearchParams({
		servings: String(validateSettings(settings).servings),
		units: validateSettings(settings).units,
		starch: "",
	});
	const side = settings.familyChoice?.[recipe.id];
	if (recipe.familyOptions.some((option) => option.id === side)) {
		params.set("starch", `${recipe.id}:${side}`);
		params.set(
			"sideDiners",
			String(
				validateSettings({
					...settings,
					familyDiners:
						settings.familyDiners ?? settings.servings ?? BASE_SERVINGS,
				}).familyDiners,
			),
		);
	}
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

// Keep explicit choices in the current URL so reloads retain the visible recipe.
export function recipePageURL(url, recipe, settings) {
	const next = new URL(url);
	for (const key of ["servings", "units", "starch", "sideDiners"])
		next.searchParams.delete(key);
	const selected = new URL(recipeHref(recipe, settings), next);
	for (const [key, value] of selected.searchParams)
		next.searchParams.set(key, value);
	return next;
}

const retiredIds = new Set(retired.map(({ id }) => id));

/** Known legacy fragments have an explicit notice at their original recipe URL. */
export function retiredRecipePath(id) {
	return retiredIds.has(id) ? `/recipes/${id}/` : null;
}
