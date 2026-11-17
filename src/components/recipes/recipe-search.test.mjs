import assert from "node:assert/strict";
import { it } from "vitest";
import data from "./recipe-data.server.mjs";
import { createRecipeSearch } from "./recipe-search.mjs";

const search = createRecipeSearch(data.recipes);
const ids = (query) => search(query).map((recipe) => recipe.id);

it("recipe search matches accents, prefixes and a common transposed typo", () => {
	assert.ok(
		ids("jalapeno").includes("source-jalapen-o-popper-stuffed-chicken-breast"),
	);
	assert.ok(
		ids("jalapeño").includes("source-jalapen-o-popper-stuffed-chicken-breast"),
	);
	assert.ok(ids("aspar").includes("lemon-salmon-and-asparagus"));
	assert.ok(
		search("chikcen").some((recipe) =>
			recipe.title.toLowerCase().includes("chicken"),
		),
	);
});

it("recipe search covers ingredients, equipment labels, cooking steps and family sides", () => {
	assert.ok(ids("hemp asparagus").includes("lemon-salmon-and-asparagus"));
	assert.ok(ids("air fryer").includes("lemon-salmon-and-asparagus"));
	assert.ok(ids("pressure cooker").includes("salsa-verde-shredded-chicken"));
	assert.ok(ids("skin down").includes("lemon-salmon-and-asparagus"));
	assert.ok(ids("pita").includes("shawarma-chicken-bowls"));
	assert.ok(ids("omega").includes("lemon-salmon-and-asparagus"));
	const sharedTable = {
		...data.recipes[0],
		sharedTable: "Offer pumpernickel separately.",
	};
	assert.equal(
		createRecipeSearch([sharedTable])("pumpernickel")[0].id,
		sharedTable.id,
	);
});

it("recipe search ranks names first, requires every word and handles empty or unmatched queries", () => {
	assert.equal(
		search("lemon salmon asparagus")[0].id,
		"lemon-salmon-and-asparagus",
	);
	assert.equal(search("   "), data.recipes);
	assert.deepEqual(search("zzzznotaningredient"), []);
	assert.deepEqual(search("salmon zzzznotaningredient"), []);
	assert.deepEqual(search("https://fdc.nal.usda.gov"), []);
	assert.deepEqual(search("!!!"), []);
});
