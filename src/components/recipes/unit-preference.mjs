import { STORAGE_KEY } from "./constants.mjs";
import { unitPreference } from "./ingredient-units.mjs";

const offersSide = (recipe, side) =>
	recipe.familyOptions.some((option) => option.id === side);

/**
 * A recipe page's saved units and that recipe's optional side ("" for none),
 * read from the library's settings record. Invalid or stale values default.
 */
export function readRecipePreferences(recipe, getStorage = () => localStorage) {
	try {
		const saved = JSON.parse(getStorage().getItem(STORAGE_KEY) || "null");
		const choices = saved?.familyChoice;
		const side =
			choices &&
			typeof choices === "object" &&
			Object.hasOwn(choices, recipe.id)
				? choices[recipe.id]
				: "";
		return {
			units: unitPreference(saved?.units),
			side: offersSide(recipe, side) ? side : "",
		};
	} catch (error) {
		console.error(
			"Recipe preferences could not be restored; using US imperial and no side.",
			error instanceof Error ? error.name : "Unknown error",
		);
		return { units: "us", side: "" };
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
			console.error(
				`Malformed recipe settings were discarded while saving ${label}.`,
				error instanceof Error ? error.name : "Unknown error",
			);
		}
		const prior =
			saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
		storage.setItem(STORAGE_KEY, JSON.stringify(change(prior)));
	} catch (error) {
		console.error(
			`Recipe ${label} could not be saved; changes apply only to this visit.`,
			error instanceof Error ? error.name : "Unknown error",
		);
	}
}
export function writeUnitPreference(units, getStorage = () => localStorage) {
	updateSavedSettings(
		(prior) => ({ ...prior, units: unitPreference(units) }),
		"units",
		getStorage,
	);
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

/** An explicit choice replaces the share link's old override before a reload. */
export function replaceUnitURL(units) {
	const url = new URL(window.location.href);
	url.searchParams.set("units", unitPreference(units));
	window.history.replaceState(window.history.state, "", url);
}
