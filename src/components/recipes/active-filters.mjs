import { nutritionHighlights, proteins, starchOptions } from "./constants.mjs";

// The checkbox filters' visible labels, in the order the Filters section
// lists them.
const CHECK_LABELS = {
	vegetarianOnly: "Vegetarian",
	dumpAndGo: "Dump and go",
	immuneSupport: nutritionHighlights.immune.label,
	ironRich: nutritionHighlights.iron.label,
	omega3: nutritionHighlights.omega.label,
};

/**
 * What narrows the collection's results, one chip each in the controls' order:
 * the chosen proteins and carbs (meals) or ingredients (smoothies), each
 * checked filter, then the search. Only filters the browse applies count, as
 * in browseFilterSettings: meal-only choices on meals, ingredients on
 * smoothies, and Iron-rich only where the collection has an iron-rich recipe
 * (`hasIron`). Appliances are the reader's kitchen, not a filter, so they
 * never appear. `ingredientLabels` maps smoothie ingredient ids to names.
 */
export function activeFilters(
	filters,
	query,
	{ collection, hasIron, ingredientLabels },
) {
	const meal = collection === "meal";
	const applies = {
		vegetarianOnly: meal,
		dumpAndGo: meal,
		immuneSupport: true,
		ironRich: hasIron,
		omega3: true,
	};
	const choices = meal
		? [
				["proteinChoice", proteins],
				["starchChoice", starchOptions],
			]
		: [["ingredientChoice", ingredientLabels]];
	const chips = choices.flatMap(([key, labels]) =>
		filters[key].map((value) => ({
			key,
			value,
			label: labels[value] ?? value,
		})),
	);
	for (const [key, label] of Object.entries(CHECK_LABELS))
		if (filters[key] && applies[key]) chips.push({ key, label });
	const search = query.trim();
	if (search) chips.push({ key: "query", label: `“${search}”` });
	return chips;
}

/** The filters with one chip's choice removed (search chips are cleared by the caller). */
export function withoutFilter(filters, chip) {
	if (chip.key === "query") return filters;
	return Array.isArray(filters[chip.key])
		? {
				...filters,
				[chip.key]: filters[chip.key].filter((value) => value !== chip.value),
			}
		: { ...filters, [chip.key]: false };
}

/**
 * The filters with every shown chip removed. Filters the collection does not
 * apply (meal choices on smoothies) stay saved for when they apply again.
 */
export function withoutFilters(filters, chips) {
	return chips.reduce(withoutFilter, filters);
}
