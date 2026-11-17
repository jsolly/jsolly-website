import assert from "node:assert/strict";
import { it } from "vitest";
import {
	activeFilters,
	withoutFilter,
	withoutFilters,
} from "./active-filters.mjs";
import { DEFAULT_FILTERS } from "./constants.mjs";

const filters = {
	...DEFAULT_FILTERS,
	proteinChoice: ["chicken", "fish"],
	starchChoice: ["rice"],
	ingredientChoice: ["spinach"],
	vegetarianOnly: true,
	dumpAndGo: true,
	immuneSupport: true,
	ironRich: true,
	omega3: true,
};
const meals = { collection: "meal", hasIron: true, ingredientLabels: {} };
const smoothies = {
	collection: "smoothie",
	hasIron: false,
	ingredientLabels: { spinach: "Baby spinach" },
};

it("meal chips list proteins, carbs, then checked filters and the search, in the controls' order", () => {
	assert.deepEqual(activeFilters(filters, "  garlic ", meals), [
		{ key: "proteinChoice", value: "chicken", label: "Chicken" },
		{ key: "proteinChoice", value: "fish", label: "Fish" },
		{ key: "starchChoice", value: "rice", label: "Rice" },
		{ key: "vegetarianOnly", label: "Vegetarian" },
		{ key: "dumpAndGo", label: "Dump and go" },
		{ key: "immuneSupport", label: "Immune support" },
		{ key: "ironRich", label: "Iron-rich" },
		{ key: "omega3", label: "High in Omega-3s" },
		{ key: "query", label: "“garlic”" },
	]);
	assert.deepEqual(activeFilters(DEFAULT_FILTERS, "   ", meals), []);
});

it("smoothie chips list ingredients and the applied shared checks, never meal-only filters or Iron-rich without iron-rich smoothies", () => {
	assert.deepEqual(activeFilters(filters, "", smoothies), [
		{ key: "ingredientChoice", value: "spinach", label: "Baby spinach" },
		{ key: "immuneSupport", label: "Immune support" },
		{ key: "omega3", label: "High in Omega-3s" },
	]);
});

it("removing a chip drops only its choice, and removing every shown chip keeps filters the collection does not apply", () => {
	assert.deepEqual(
		withoutFilter(filters, { key: "proteinChoice", value: "chicken" })
			.proteinChoice,
		["fish"],
	);
	assert.equal(
		withoutFilter(filters, { key: "vegetarianOnly" }).vegetarianOnly,
		false,
	);
	assert.equal(withoutFilter(filters, { key: "query" }), filters);
	assert.deepEqual(filters.proteinChoice, ["chicken", "fish"]);
	assert.deepEqual(
		withoutFilters(filters, activeFilters(filters, "garlic", smoothies)),
		{ ...filters, ingredientChoice: [], immuneSupport: false, omega3: false },
	);
	assert.deepEqual(withoutFilters(filters, activeFilters(filters, "", meals)), {
		...DEFAULT_FILTERS,
		ingredientChoice: ["spinach"],
	});
});
