import assert from "node:assert/strict";
import { it } from "vitest";
import {
	readRecipeURL,
	recipeBrowseHref,
	recipeHref,
	recipePageURL,
} from "./recipe-url.mjs";

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
			familyDiners: 6,
			familyChoice: { "greek-turkey-patties": "bun_one" },
			recipeId: "greek-turkey-patties",
		},
	);
	assert.deepEqual(read("/recipes/#spinach-feta-and-hemp-frittata"), {
		servings: 4,
		units: "us",
		familyDiners: 0,
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
		{
			servings: 4,
			units: "us",
			familyDiners: 0,
			familyChoice: {},
			recipeId: "",
		},
	);
	assert.deepEqual(read("/recipes/?servings=lots"), {
		servings: 4,
		units: "us",
		familyDiners: 0,
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
		"/recipes/greek-turkey-patties/?servings=6&units=us&starch=greek-turkey-patties%3Apita_one&sideDiners=6",
	);
	assert.equal(
		recipeHref(patties, {
			servings: 3,
			units: "us",
			familyChoice: { "greek-turkey-patties": "rice_half_cup" },
		}),
		// biome-ignore lint/security/noSecrets: public recipe settings URL, not credential material.
		"/recipes/greek-turkey-patties/?servings=4&units=us&starch=",
	);
	assert.equal(
		recipeHref(frittata, { servings: 2 }),
		// biome-ignore lint/security/noSecrets: public recipe settings URL, not credential material.
		"/recipes/spinach-feta-and-hemp-frittata/?servings=2&units=us&starch=",
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
		familyDiners: 8,
		familyChoice: { "greek-turkey-patties": "bun_one" },
		recipeId: "greek-turkey-patties",
	});
});

it("shared sides retain an independent diner count and clamp it to the meal size", () => {
	const settings = {
		servings: 4,
		units: "us",
		familyDiners: 2,
		familyChoice: { [patties.id]: "pita_one" },
	};
	const restored = read(recipeHref(patties, settings));
	assert.equal(restored.servings, 4);
	assert.equal(restored.familyDiners, 2);
	assert.deepEqual(restored.familyChoice, settings.familyChoice);
	assert.equal(
		read("/recipes/greek-turkey-patties/?servings=4&sideDiners=8").familyDiners,
		4,
	);
	assert.equal(
		read("/recipes/greek-turkey-patties/?sideDiners=invalid").familyDiners,
		0,
	);
	assert.equal(
		read("/recipes/greek-turkey-patties/?sideDiners=0").familyDiners,
		0,
	);
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
		// biome-ignore lint/security/noSecrets: public recipe settings URL, not credential material.
		"/recipes/greek-turkey-patties/?servings=4&units=us&starch=",
	);
});

it("a recipe page's URL keeps units, the selected side and servings after a change", () => {
	const path = `/recipes/${patties.id}/`;
	const page = (search, settings) =>
		Object.fromEntries(
			recipePageURL(new URL(`${path}${search}`, SITE), patties, settings)
				.searchParams,
		);
	assert.deepEqual(
		page("", {
			servings: 4,
			units: "grams",
			familyChoice: { [patties.id]: "pita_one" },
		}),
		{
			servings: "4",
			units: "grams",
			starch: `${patties.id}:pita_one`,
			sideDiners: "4",
		},
	);
	assert.deepEqual(
		page(`?servings=4&units=us&starch=${patties.id}:bun_one`, {
			servings: 6,
			units: "metric",
			familyChoice: {},
		}),
		{ servings: "6", units: "metric", starch: "" },
	);
	assert.deepEqual(
		page("?servings=8", {
			servings: 4,
			units: "us",
			familyChoice: { [patties.id]: "naan" },
		}),
		{ servings: "4", units: "us", starch: "" },
	);
	assert.equal(
		readRecipeURL(
			recipePageURL(new URL(path, SITE), patties, { servings: 4 }),
			recipes,
			{ servings: 8 },
		).servings,
		4,
		"an explicit four-serving choice survives even if saved preferences retain eight",
	);
});

it("ordinary links restore saved sides while an explicit None clears only the named recipe", () => {
	const other = { ...patties, id: "other-meal" };
	const context = [...recipes, other];
	const saved = {
		servings: 4,
		units: "us",
		familyDiners: 2,
		familyChoice: {
			[patties.id]: "pita_one",
			[other.id]: "bun_one",
			[frittata.id]: "stale",
			removed: "pita_one",
		},
	};
	const original = structuredClone(saved);
	const ordinary = readRecipeURL(
		new URL(recipeBrowseHref(patties, {}), SITE),
		context,
		saved,
	);
	assert.equal(ordinary.familyDiners, 2);
	assert.deepEqual(ordinary.familyChoice, {
		[patties.id]: "pita_one",
		[other.id]: "bun_one",
	});
	const sharedNone = recipeHref(patties, { servings: 4, units: "us" });
	assert.equal(new URL(sharedNone, SITE).searchParams.has("starch"), true);
	assert.deepEqual(
		readRecipeURL(new URL(sharedNone, SITE), context, saved).familyChoice,
		{ [other.id]: "bun_one" },
	);
	assert.deepEqual(
		readRecipeURL(
			new URL(`/recipes/${patties.id}/?servings=4&units=us`, SITE),
			context,
			saved,
		).familyChoice,
		{ [other.id]: "bun_one" },
		"older explicit shares without starch still mean no side",
	);
	const invalid = new URL(
		`/recipes/${patties.id}/?starch=${patties.id}:stale`,
		SITE,
	);
	assert.deepEqual(readRecipeURL(invalid, context, saved).familyChoice, {
		[other.id]: "bun_one",
	});
	const selected = recipeHref(patties, {
		servings: 4,
		units: "us",
		familyDiners: 1,
		familyChoice: { [patties.id]: "bun_one" },
	});
	const restored = readRecipeURL(new URL(selected, SITE), context, saved);
	assert.equal(restored.familyDiners, 1);
	assert.equal(restored.familyChoice[patties.id], "bun_one");
	assert.deepEqual(saved, original);
});
