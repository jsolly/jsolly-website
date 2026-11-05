import {
	applianceChoices,
	applianceLimits,
	BASE_SERVINGS,
	DEFAULT_FILTERS,
	defaultAppliances,
	proteins,
	SERVING_CHOICES,
	starchOptions,
} from "./constants.mjs";
export const UNIT_LABELS = {
	grams: "Grams",
	us: "US imperial",
	metric: "Metric",
};

const SERVINGS = new Set(SERVING_CHOICES);
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function unitPreference(value) {
	return typeof value === "string" && Object.hasOwn(UNIT_LABELS, value)
		? value
		: "us";
}
export function validateSettings(settings = {}) {
	const servings = SERVINGS.has(Number(settings?.servings))
		? Number(settings.servings)
		: BASE_SERVINGS;
	const familyDiners = Number.isInteger(Number(settings?.familyDiners))
		? Math.max(0, Math.min(servings, Number(settings.familyDiners)))
		: 0;
	const units = unitPreference(settings?.units);
	return { servings, familyDiners, units };
}

export function formatNutrition(value, unit = "", decimals = 0) {
	return finite(value)
		? `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`
		: "Not provided";
}

export function normalizeSelection(value, options) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item) => Object.hasOwn(options, item)))];
}
export function choiceUnavailable(picked, wouldMatch) {
	return !picked && !wouldMatch();
}
export function availableAppliances(value) {
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.keys(applianceChoices).map((key) => [
				key,
				Math.max(
					0,
					Math.min(
						applianceLimits[key] ?? 1,
						Number.isInteger(value[key]) ? value[key] : defaultAppliances[key],
					),
				),
			]),
		);
	return { ...defaultAppliances };
}
const isObject = (value) =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The library's saved settings (localStorage recipes-settings-v1), validated
// key by key: anything missing, of the wrong shape or no longer offered
// restores its default. `recipes` are the library's recipes (a family side
// must still be one of its recipe's sides) and `ingredients` the smoothie
// ingredient choices.
export function parseSavedSettings(saved, { recipes, ingredients }) {
	const settings = isObject(saved) ? saved : {};
	const filters = isObject(settings.filters) ? settings.filters : {};
	const familyChoice = isObject(settings.familyChoice)
		? Object.fromEntries(
				Object.entries(settings.familyChoice).filter(([id, side]) =>
					recipes
						.find((recipe) => recipe.id === id)
						?.familyOptions.some((option) => option.id === side),
				),
			)
		: {};
	const flag = (key) => filters[key] === true;
	const servings = validateSettings({ servings: settings.servings }).servings;
	const familyDiners =
		settings.familyDiners === undefined && Object.keys(familyChoice).length
			? servings
			: settings.familyDiners;
	return {
		servings,
		familyDiners: validateSettings({ servings, familyDiners }).familyDiners,
		units: validateSettings({ units: settings.units }).units,
		filters: {
			...DEFAULT_FILTERS,
			proteinChoice: normalizeSelection(filters.proteinChoice, proteins),
			starchChoice: normalizeSelection(filters.starchChoice, starchOptions),
			ingredientChoice: normalizeSelection(
				filters.ingredientChoice,
				ingredients,
			),
			vegetarianOnly: flag("vegetarianOnly"),
			immuneSupport: flag("immuneSupport"),
			ironRich: flag("ironRich"),
			omega3: flag("omega3"),
			dumpAndGo: flag("dumpAndGo"),
		},
		appliancesOnHand: availableAppliances(settings.appliancesOnHand),
		familyChoice,
	};
}
