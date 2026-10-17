import assert from "node:assert/strict";
import it from "node:test";
import { readRecipeURL, recipeBrowseHref, recipeHref } from "./recipe-url.mjs";

const SITE = "https://www.jsolly.com";
// Two recipes in the recipes.json shape recipe-url reads: one with family
// sides, one without.
const patties = {
	id: "greek-turkey-patties",
	familyOptions: [{ id: "pita_one" }, { id: "bun_one" }],
};
const frittata = { id: "spinach-feta-and-hemp-frittata", familyOptions: [] };
const recipes = [patties, frittata];
const read = (path) => readRecipeURL(new URL(path, SITE), recipes);

it("a shared recipe link restores its servings, family side and recipe", () => {
	assert.deepEqual(
		read(
			// biome-ignore lint/security/noSecrets: a recipe share URL fixture, not credential material.
			"/recipes/greek-turkey-patties/?servings=6&starch=greek-turkey-patties:bun_one",
		),
		{
			servings: 6,
			units: "us",
			familyChoice: { "greek-turkey-patties": "bun_one" },
			recipeId: "greek-turkey-patties",
		},
	);
	assert.deepEqual(read("/recipes/#spinach-feta-and-hemp-frittata"), {
		servings: 4,
		units: "us",
		familyChoice: {},
		recipeId: "spinach-feta-and-hemp-frittata",
	});
});

it("a link with unsupported servings, unknown sides or no recipe falls back to the defaults", () => {
	assert.deepEqual(
		read(
			// biome-ignore lint/security/noSecrets: a recipe share URL fixture, not credential material.
			"/recipes/?servings=5&starch=greek-turkey-patties:rice_half_cup,nope:bun_one,spinach-feta-and-hemp-frittata:pita_one,broken",
		),
		{ servings: 4, units: "us", familyChoice: {}, recipeId: "" },
	);
	assert.deepEqual(read("/recipes/?servings=lots"), {
		servings: 4,
		units: "us",
		familyChoice: {},
		recipeId: "",
	});
	assert.equal(
		readRecipeURL(new URL("/recipes/", SITE), recipes, { servings: 8 })
			.servings,
		8,
		"no ?servings= uses the caller's default",
	);
});

it("a recipe's share link carries its servings and only a family side the recipe offers", () => {
	assert.equal(
		recipeHref(patties, {
			servings: 6,
			units: "us",
			familyChoice: { "greek-turkey-patties": "pita_one" },
		}),
		// biome-ignore lint/security/noSecrets: a recipe share URL fixture, not credential material.
		"/recipes/greek-turkey-patties/?servings=6&units=us&starch=greek-turkey-patties%3Apita_one",
	);
	assert.equal(
		recipeHref(patties, {
			servings: 3,
			units: "us",
			familyChoice: { "greek-turkey-patties": "rice_half_cup" },
		}),
		"/recipes/greek-turkey-patties/?servings=4&units=us",
	);
	assert.equal(
		recipeHref(frittata, { servings: 2 }),
		"/recipes/spinach-feta-and-hemp-frittata/?servings=2&units=us",
	);
});

it("a share link reads back as the settings it was made from", () => {
	const settings = {
		servings: 8,
		units: "us",
		familyChoice: { "greek-turkey-patties": "bun_one" },
	};
	assert.deepEqual(read(recipeHref(patties, settings)), {
		servings: 8,
		units: "us",
		familyChoice: { "greek-turkey-patties": "bun_one" },
		recipeId: "greek-turkey-patties",
	});
});

it("default browsing links use canonical paths while selected and shared settings remain explicit", () => {
	assert.equal(recipeBrowseHref(patties, {}), "/recipes/greek-turkey-patties/");
	assert.equal(
		recipeBrowseHref(patties, {
			servings: 4,
			units: "us",
			familyChoice: { [patties.id]: "stale" },
		}),
		"/recipes/greek-turkey-patties/",
	);
	for (const settings of [
		{ servings: 6, units: "us" },
		{ servings: 4, units: "grams" },
		{ servings: 4, units: "us", familyChoice: { [patties.id]: "pita_one" } },
	]) {
		assert.equal(
			recipeBrowseHref(patties, settings),
			recipeHref(patties, settings),
		);
	}
	assert.equal(
		recipeHref(patties, { servings: 4, units: "us" }),
		"/recipes/greek-turkey-patties/?servings=4&units=us",
	);
});
