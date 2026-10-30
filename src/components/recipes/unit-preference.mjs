import { reportError } from "../../lib/report-error.mjs";
import { BASE_SERVINGS, STORAGE_KEY } from "./constants.mjs";
import { validateSettings } from "./recipe-settings.mjs";

/** Retire obsolete switches without pruning unrelated collection preferences. */
function currentRecipePreferences(value) {
	const settings =
		value && typeof value === "object" && !Array.isArray(value) ? value : {};
	if (
		!settings.filters ||
		typeof settings.filters !== "object" ||
		Array.isArray(settings.filters)
	)
		return settings;
	const filters = Object.fromEntries(
		Object.entries(settings.filters).filter(
			([key]) => !["mealKetoOnly", "smoothieKetoOnly"].includes(key),
		),
	);
	return { ...settings, filters };
}

const offersSide = (recipe, side) =>
	recipe.familyOptions.some((option) => option.id === side);

/** Read the page's validated settings from the shared library preference record. */
export function readRecipePreferences(recipe, getStorage = () => localStorage) {
	try {
		const saved = currentRecipePreferences(
			JSON.parse(getStorage().getItem(STORAGE_KEY) || "null"),
		);
		const choice = saved.familyChoice?.[recipe.id];
		const side = offersSide(recipe, choice) ? choice : "";
		const settings = validateSettings({
			...saved,
			familyDiners:
				saved.familyDiners === undefined && side
					? (saved.servings ?? BASE_SERVINGS)
					: saved.familyDiners,
		});
		return {
			units: settings.units,
			side,
			servings: settings.servings,
			familyDiners: settings.familyDiners,
		};
	} catch (error) {
		void reportError("recipe-storage-read");
		console.error(
			"Recipe preferences could not be restored; using US imperial and no side.",
			error instanceof Error ? error.name : "Unknown error",
		);
		return { units: "us", side: "", servings: BASE_SERVINGS, familyDiners: 0 };
	}
}
// Updates the library's saved settings (STORAGE_KEY) in place, keeping every
// unrelated field, so a recipe page and the library share one preference record.
function updateSavedSettings(change, label, getStorage) {
	try {
		const storage = getStorage();
		const raw = storage.getItem(STORAGE_KEY);
		let saved;
		try {
			saved = JSON.parse(raw || "null");
		} catch (error) {
			void reportError("recipe-storage-read");
			console.error(
				// nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- Internal callers choose label from fixed literals; external values are not used as format strings.
				`Malformed recipe settings were discarded while saving ${label}.`,
				error instanceof Error ? error.name : "Unknown error",
			);
		}
		const prior = currentRecipePreferences(saved);
		storage.setItem(STORAGE_KEY, JSON.stringify(change(prior)));
		return true;
	} catch (error) {
		void reportError("recipe-storage-write");
		console.error(
			// nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- Internal callers choose label from fixed literals; external values are not used as format strings.
			`Recipe ${label} could not be saved; changes apply only to this visit.`,
			error instanceof Error ? error.name : "Unknown error",
		);
		return false;
	}
}
/** Saves one recipe's side in the library's familyChoice; none removes it. */
export function writeSidePreference(
	recipe,
	side,
	getStorage = () => localStorage,
) {
	updateSavedSettings(
		(prior) => {
			const choices =
				prior.familyChoice &&
				typeof prior.familyChoice === "object" &&
				!Array.isArray(prior.familyChoice)
					? { ...prior.familyChoice }
					: {};
			if (offersSide(recipe, side)) choices[recipe.id] = side;
			else delete choices[recipe.id];
			return { ...prior, familyChoice: choices };
		},
		"side",
		getStorage,
	);
}

/** Save the current page atomically while retaining every other recipe's side. */
export function writeRecipePreferences(
	recipe,
	settings,
	getStorage = () => localStorage,
) {
	return updateSavedSettings(
		(prior) => {
			const choices =
				prior.familyChoice &&
				typeof prior.familyChoice === "object" &&
				!Array.isArray(prior.familyChoice)
					? { ...prior.familyChoice }
					: {};
			const side = settings.familyChoice?.[recipe.id];
			if (offersSide(recipe, side)) choices[recipe.id] = side;
			else delete choices[recipe.id];
			return { ...prior, ...validateSettings(settings), familyChoice: choices };
		},
		"preferences",
		getStorage,
	);
}
