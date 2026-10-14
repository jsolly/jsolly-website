import { STORAGE_KEY } from "./constants.mjs";
import { unitPreference } from "./ingredient-units.mjs";

export function readUnitPreference(getStorage = () => localStorage) {
	try {
		return unitPreference(
			JSON.parse(getStorage().getItem(STORAGE_KEY) || "null")?.units,
		);
	} catch (error) {
		console.error(
			"Recipe units could not be restored; using US imperial.",
			error instanceof Error ? error.name : "Unknown error",
		);
		return "us";
	}
}
export function writeUnitPreference(units, getStorage = () => localStorage) {
	try {
		const storage = getStorage();
		const raw = storage.getItem(STORAGE_KEY);
		let saved;
		try {
			saved = JSON.parse(raw || "null");
		} catch (error) {
			console.error(
				"Malformed recipe settings were discarded while saving units.",
				error instanceof Error ? error.name : "Unknown error",
			);
		}
		const prior =
			saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...prior, units: unitPreference(units) }),
		);
	} catch (error) {
		console.error(
			"Recipe units could not be saved; changes apply only to this visit.",
			error instanceof Error ? error.name : "Unknown error",
		);
	}
}

/** An explicit choice replaces the share link's old override before a reload. */
export function replaceUnitURL(units) {
	const url = new URL(window.location.href);
	url.searchParams.set("units", unitPreference(units));
	window.history.replaceState(null, "", url);
}
