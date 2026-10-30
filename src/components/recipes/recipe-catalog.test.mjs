import assert from "node:assert/strict";
import { it } from "vitest";
import { recipeCatalog, recipeCatalogItemList } from "./recipe-catalog.mjs";
import data from "./recipe-data.server.mjs";
import retired from "./retired-recipes.json" with { type: "json" };

const GRAMS = /^\d+ g$/u;

it("the static catalog lists each published recipe once, meals before smoothies", () => {
	const groups = recipeCatalog(data.recipes);
	assert.deepEqual(
		groups.map(({ type }) => type),
		["meal", "smoothie"],
	);
	const entries = groups.flatMap(({ recipes }) => recipes);
	assert.equal(entries.length, data.recipes.length);
	assert.equal(new Set(entries.map(({ id }) => id)).size, data.recipes.length);
	assert.deepEqual(
		entries.map(({ id }) => id).sort(),
		data.recipes.map(({ id }) => id).sort(),
	);
	for (const recipe of retired)
		assert.ok(!entries.some(({ id }) => id === recipe.id));
	for (const group of groups) {
		assert.deepEqual(
			group.recipes.map(({ id }) => id),
			data.recipes
				.filter(({ type }) => type === group.type)
				.map(({ id }) => id),
		);
	}
});

it("catalog portion labels retain unknown prep times and distinguish household active time", () => {
	const source = data.recipes.find(({ sourceRecipe }) => sourceRecipe);
	const household = data.recipes.find(({ sourceRecipe }) => !sourceRecipe);
	const [meals] = recipeCatalog([
		{ ...source, activeMinutes: null },
		{ ...household, activeMinutes: 15 },
	]);
	assert.equal(meals.recipes[0].timeLabel, "Prep time");
	assert.equal(meals.recipes[0].time, "Not provided");
	assert.equal(meals.recipes[1].timeLabel, "Active time");
	assert.equal(meals.recipes[1].time, "15 min");
	assert.match(meals.recipes[1].netCarbs, GRAMS);
});

it("the ItemList points at every canonical recipe in the same order as visible HTML", () => {
	const groups = recipeCatalog(data.recipes);
	const list = recipeCatalogItemList(groups, new URL("https://www.jsolly.com"));
	assert.equal(list["@type"], "ItemList");
	assert.equal(list["@id"], "https://www.jsolly.com/recipes/all/#recipes");
	assert.deepEqual(
		list.itemListElement,
		groups
			.flatMap(({ recipes }) => recipes)
			.map(({ href }, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: `https://www.jsolly.com${href}`,
			})),
	);
});
