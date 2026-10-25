import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { MADE_STORAGE_KEY } from "./constants.mjs";
import {
	madeDateFor,
	madeDateLabel,
	readMadeRecipes,
	todayMadeDate,
	writeMadeRecipe,
} from "./recipe-made.mjs";

function memoryStorage(initial) {
	const values = new Map(
		initial === undefined ? [] : [[MADE_STORAGE_KEY, initial]],
	);
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}

it("marking a recipe made records its date, keeps other recipes, and clearing removes only that recipe", () => {
	const storage = memoryStorage();
	assert.deepEqual(
		readMadeRecipes(() => storage),
		{},
	);
	assert.equal(
		writeMadeRecipe("lemon-salmon", "2026-10-20", () => storage),
		true,
	);
	assert.equal(
		writeMadeRecipe("greek-turkey-patties", "2026-10-24", () => storage),
		true,
	);
	writeMadeRecipe("lemon-salmon", "2026-10-24", () => storage);
	assert.deepEqual(
		readMadeRecipes(() => storage),
		{ "lemon-salmon": "2026-10-24", "greek-turkey-patties": "2026-10-24" },
	);
	writeMadeRecipe("lemon-salmon", "", () => storage);
	assert.deepEqual(JSON.parse(storage.values.get(MADE_STORAGE_KEY)), {
		"greek-turkey-patties": "2026-10-24",
	});
});

it("dates are local calendar days, labelled in US English, and impossible dates are dropped on read", () => {
	assert.equal(todayMadeDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
	assert.equal(madeDateLabel("2026-10-24"), "Oct 24, 2026");
	for (const invalid of [
		"2026-02-30",
		"2026-13-01",
		"0050-03-01",
		"24/10/2026",
		20261024,
	])
		assert.equal(madeDateLabel(invalid), "", String(invalid));
	const storage = memoryStorage(
		JSON.stringify({
			salmon: "2026-10-24",
			patties: "2026-02-30",
			frittata: 3,
			soup: null,
		}),
	);
	const made = readMadeRecipes(() => storage);
	assert.deepEqual(made, { salmon: "2026-10-24" });
	assert.equal(madeDateFor(made, "salmon"), "2026-10-24");
	for (const id of ["patties", "constructor", "toString"])
		assert.equal(madeDateFor(made, id), "", id);
	for (const shape of ["[]", '"made"', "null"])
		assert.deepEqual(
			readMadeRecipes(() => memoryStorage(shape)),
			{},
			shape,
		);
});

it("an unreadable record or a refused save is logged and reported, never thrown, and a save replaces an unreadable record", () => {
	const errors = [];
	vi.spyOn(console, "error").mockImplementation((...args) => {
		errors.push(args.join(" "));
	});
	try {
		const malformed = memoryStorage("{not json");
		assert.deepEqual(
			readMadeRecipes(() => malformed),
			{},
		);
		const denied = () => {
			throw new DOMException("denied", "SecurityError");
		};
		assert.equal(writeMadeRecipe("salmon", "2026-10-24", denied), false);
		assert.equal(
			writeMadeRecipe("salmon", "2026-10-24", () => malformed),
			true,
		);
		assert.deepEqual(JSON.parse(malformed.values.get(MADE_STORAGE_KEY)), {
			salmon: "2026-10-24",
		});
		assert.deepEqual(errors, [
			"Made recipes could not be restored; showing none as made. SyntaxError",
			"A made recipe could not be saved; the mark applies only to this visit. SecurityError",
			"Malformed made recipes were discarded while saving. SyntaxError",
		]);
	} finally {
		vi.restoreAllMocks();
	}
});
