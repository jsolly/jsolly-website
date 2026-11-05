import { reportError } from "../../lib/report-error.mjs";
import { MADE_STORAGE_KEY } from "./constants.mjs";

// The record maps a recipe id to the local calendar date the reader last made
// it, as YYYY-MM-DD. It lives only in this browser's localStorage.
const ISO_DATE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const MADE_DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function calendarDate(value) {
	const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
	if (!match?.groups) return null;
	const [year, month, day] = [
		match.groups.year,
		match.groups.month,
		match.groups.day,
	].map(Number);
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
		? date
		: null;
}

// The valid entries of a stored value; throws on JSON that does not parse.
function madeEntries(raw) {
	const saved = JSON.parse(raw || "null");
	if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
	return Object.fromEntries(
		Object.entries(saved).filter(([, date]) => calendarDate(date)),
	);
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayMadeDate(now = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Oct 24, 2026" for a stored date, or "" for one that is not a real date. */
export function madeDateLabel(value) {
	const date = calendarDate(value);
	return date ? MADE_DATE.format(date) : "";
}

/** One recipe's stored date, or "" (only the record's own entries count). */
export function madeDateFor(made, id) {
	return Object.hasOwn(made, id) ? made[id] : "";
}

/** The saved record with every entry that is not a real date dropped. */
export function readMadeRecipes(getStorage = () => localStorage) {
	try {
		return madeEntries(getStorage().getItem(MADE_STORAGE_KEY));
	} catch (error) {
		void reportError("recipe-storage-read");
		console.error(
			"Made recipes could not be restored; showing none as made.",
			error instanceof Error ? error.name : "Unknown error",
		);
		return {};
	}
}

/**
 * Marks one recipe made on `date`, or clears it when `date` is "". Keeps every
 * other recipe's entry. Returns false when the browser refuses to save.
 */
export function writeMadeRecipe(id, date, getStorage = () => localStorage) {
	try {
		const storage = getStorage();
		let made = {};
		try {
			made = madeEntries(storage.getItem(MADE_STORAGE_KEY));
		} catch (error) {
			void reportError("recipe-storage-read");
			console.error(
				"Malformed made recipes were discarded while saving.",
				error instanceof Error ? error.name : "Unknown error",
			);
		}
		if (date) made[id] = date;
		else delete made[id];
		storage.setItem(MADE_STORAGE_KEY, JSON.stringify(made));
		return true;
	} catch (error) {
		void reportError("recipe-storage-write");
		console.error(
			"A made recipe could not be saved; the mark applies only to this visit.",
			error instanceof Error ? error.name : "Unknown error",
		);
		return false;
	}
}

/**
 * Calls `onChange` when the record may have changed outside this page: another
 * tab saved it, Back restored this page, or the tab became visible again
 * (possibly on a later day). Returns the cleanup that removes the listeners.
 */
export function watchMadeRecipes(onChange) {
	const onStorage = (event) => {
		if (event.key === null || event.key === MADE_STORAGE_KEY) onChange();
	};
	const onPageShow = (event) => {
		if (event.persisted) onChange();
	};
	const onVisibility = () => {
		if (document.visibilityState === "visible") onChange();
	};
	window.addEventListener("storage", onStorage);
	window.addEventListener("pageshow", onPageShow);
	document.addEventListener("visibilitychange", onVisibility);
	return () => {
		window.removeEventListener("storage", onStorage);
		window.removeEventListener("pageshow", onPageShow);
		document.removeEventListener("visibilitychange", onVisibility);
	};
}
