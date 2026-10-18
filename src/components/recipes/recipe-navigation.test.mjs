import assert from "node:assert/strict";
import it from "node:test";
import { collectionReturn, listVisit } from "./recipe-navigation.mjs";

const current = new URL(
	// biome-ignore lint/security/noSecrets: synthetic recipe URL, not a credential.
	"https://example.test/recipes/salmon/?servings=6&units=metric",
);
it("recipe return accepts matching collections and survives reload history state", () => {
	const source =
		"https://example.test/recipes/meals/?units=metric#meal-results";
	assert.equal(
		collectionReturn(null, source, current, "meals"),
		"/recipes/meals/?units=metric#meal-results",
	);
	assert.equal(
		collectionReturn(
			{ recipeReturn: "/recipes/meals/?units=grams" },
			current.href,
			current,
			"meals",
		),
		"/recipes/meals/?units=grams",
	);
	assert.equal(
		collectionReturn(null, "https://example.test/recipes/", current, "meals"),
		"/recipes/",
	);
});
it("direct, foreign and unrelated recipe arrivals have no collection return", () => {
	for (const source of [
		"",
		"https://foreign.test/recipes/meals/",
		"javascript:alert(1)",
		"https://example.test/about/",
		"https://example.test/recipes/smoothies/",
	]) {
		assert.equal(collectionReturn(null, source, current, "meals"), "");
	}
	assert.equal(
		collectionReturn(
			{ recipeReturn: "//foreign.test/recipes/meals/" },
			"",
			current,
			"meals",
		),
		"",
	);
});
it("list history validates scroll, query and a complete unique card order", () => {
	const recipes = [{ id: "a" }, { id: "b" }];
	assert.deepEqual(
		listVisit(
			{
				recipeList: {
					scrollY: 1200,
					query: "garlic chicken",
					order: ["b", "a"],
				},
			},
			recipes,
		),
		{ scrollY: 1200, query: "garlic chicken", order: ["b", "a"], limit: 6 },
	);
	assert.deepEqual(
		listVisit(
			{ recipeList: { scrollY: 0, query: 3, order: ["a", "a"] } },
			recipes,
		),
		{ scrollY: 0, query: "", order: null, limit: 6 },
	);
	for (const scrollY of [-1, NaN, Infinity, "100"])
		assert.equal(listVisit({ recipeList: { scrollY } }, recipes), null);
	assert.equal(listVisit(null, recipes), null);
});

it("list history restores a bounded card limit and defaults older snapshots", () => {
	const recipes = Array.from({ length: 80 }, (_, id) => ({ id: String(id) }));
	const visit = (limit) =>
		listVisit({ recipeList: { scrollY: 3000, limit } }, recipes);
	assert.equal(visit(6).limit, 6);
	assert.equal(visit(12).limit, 12);
	assert.equal(visit(18).limit, 18);
	assert.equal(visit(48).limit, 48);
	assert.equal(visit(80).limit, 80);
	for (const limit of [undefined, 0, 5, 81, 48.5, "48", Infinity, NaN])
		assert.equal(visit(limit).limit, 6);
});

it("saved recipe pages return to their saved collection and selected type", () => {
	assert.equal(
		collectionReturn(
			{ recipeReturn: "/recipes/saved/?collection=smoothie" },
			"",
			current,
			"meals",
		),
		"/recipes/saved/?collection=smoothie",
	);
	assert.equal(
		collectionReturn(
			null,
			"https://example.test/recipes/saved/",
			current,
			"smoothies",
		),
		"/recipes/saved/",
	);
});
