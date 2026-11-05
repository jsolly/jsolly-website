import { SERVING_CHOICES } from "./constants.mjs";

const RELEASE = /^[a-f0-9]{40}$/u;
const DEPLOYMENT_PIN = /^\?dpl=dpl_[A-Za-z0-9]+$/u;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const libraries = new Map();
const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const flags = (value) =>
	isObject(value) &&
	["immune", "iron", "omega"].every((key) => typeof value[key] === "boolean");

export function browseLibraryPath(release) {
	if (!RELEASE.test(release))
		throw new Error("Invalid recipe library identity.");
	return `/recipes/data/summaries/library-${release}.json`;
}

/** Validate the static download once, before filters or card rendering consume it. */
export function parseBrowseLibrary(value, release) {
	if (value?.release !== release) {
		const error = new Error(
			"A newer recipe library is available. Update and reload to continue.",
		);
		error.code = "RECIPE_RELEASE_MISMATCH";
		throw error;
	}
	const ids = new Set();
	if (
		value.schemaVersion !== 1 ||
		!Array.isArray(value.recipes) ||
		!value.recipes.every((recipe) => {
			if (!isObject(recipe) || !ID.test(recipe.id) || ids.has(recipe.id))
				return false;
			ids.add(recipe.id);
			const card = recipe.browse?.card;
			return (
				["meal", "smoothie"].includes(recipe.type) &&
				Array.isArray(recipe.ingredients) &&
				recipe.ingredients.every(
					(ingredient) =>
						isObject(ingredient) &&
						typeof ingredient.id === "string" &&
						typeof ingredient.name === "string",
				) &&
				Array.isArray(recipe.familyOptions) &&
				recipe.familyOptions.every((side) => typeof side?.id === "string") &&
				Array.isArray(recipe.starches) &&
				recipe.starches.every((item) => typeof item === "string") &&
				Array.isArray(recipe.appliancesNeeded) &&
				recipe.appliancesNeeded.every((item) => typeof item === "string") &&
				isObject(card) &&
				card.id === recipe.id &&
				card.type === recipe.type &&
				typeof card.title === "string" &&
				Array.isArray(card.dietaryPills) &&
				card.dietaryPills.every((pill) => typeof pill?.label === "string") &&
				SERVING_CHOICES.every((servings) =>
					flags(recipe.browse.flags?.[servings]),
				)
			);
		})
	)
		throw new Error("The recipe library download is incomplete. Try again.");
	return value;
}

/** One release-bound request per visit; failed requests can be retried. */
export function loadBrowseArtifact(release, fetcher, url, path, parse) {
	if (
		url !== path &&
		!(url.startsWith(path) && DEPLOYMENT_PIN.test(url.slice(path.length)))
	)
		throw new Error("Invalid recipe library URL.");
	let pending = libraries.get(url);
	if (!pending) {
		pending = (async () => {
			const response = await fetcher(url, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(15000),
			});
			if (response.status === 404) {
				const error = new Error(
					"This recipe library version is no longer available. Update and reload to continue.",
				);
				error.code = "RECIPE_RELEASE_MISMATCH";
				throw error;
			}
			if (!response.ok)
				throw new Error(
					"Recipes could not be loaded. Your current results are still here.",
				);
			return parse(await response.json(), release);
		})();
		libraries.set(url, pending);
		pending.catch(() => {
			if (libraries.get(url) === pending) libraries.delete(url);
		});
	}
	return pending;
}

export function loadBrowseLibrary(
	release,
	{ fetcher = fetch, url = browseLibraryPath(release) } = {},
) {
	return loadBrowseArtifact(
		release,
		fetcher,
		url,
		browseLibraryPath(release),
		parseBrowseLibrary,
	);
}
