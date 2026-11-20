import assert from "node:assert/strict";
import { it } from "vitest";
import { collectionHref, readRecipeURL, recipeHref } from "./recipe-url.mjs";
import { needsSafariPrint, safariPrintLinks } from "./safari-print.mjs";

const recipe = {
	id: "greek-turkey-patties",
	familyOptions: [{ id: "pita_one" }],
};

it("only installed iOS and iPadOS apps need the Safari print handoff", () => {
	const iphone = {
		userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X)",
		standalone: true,
	};
	assert.equal(needsSafariPrint(iphone, false), true);
	assert.equal(needsSafariPrint({ ...iphone, standalone: false }, true), true);
	assert.equal(
		needsSafariPrint({ ...iphone, standalone: false }, false),
		false,
	);
	assert.equal(
		needsSafariPrint({ userAgent: "iPad", standalone: true }, false),
		true,
	);
	assert.equal(
		needsSafariPrint(
			{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
			true,
		),
		true,
	);
	assert.equal(
		needsSafariPrint(
			{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 },
			true,
		),
		false,
	);
	assert.equal(
		needsSafariPrint({ userAgent: "Android", standalone: true }, true),
		false,
	);
});

it("Safari and copyable links preserve recipe settings on the current Preview origin", () => {
	for (const units of ["us", "grams", "metric"]) {
		for (const servings of [2, 4, 6, 8]) {
			const settings = {
				servings,
				units,
				familyDiners: Math.min(2, servings),
				familyChoice: { [recipe.id]: "pita_one" },
			};
			const links = safariPrintLinks(
				recipeHref(recipe, settings),
				"https://preview.example.test",
			);
			const restored = readRecipeURL(new URL(links.url), [recipe]);
			assert.deepEqual(restored, { ...settings, recipeId: recipe.id });
			assert.equal(new URL(links.url).origin, "https://preview.example.test");
			assert.equal(links.safari, `x-safari-${links.url}`);
		}
	}
});

it("local HTTP testing retains a copyable link without offering an invalid Safari scheme", () => {
	const links = safariPrintLinks(
		recipeHref(recipe, { servings: 6, units: "metric" }),
		"http://localhost:4321",
	);
	assert.equal(links.safari, "");
	assert.equal(
		links.url,
		// biome-ignore lint/security/noSecrets: public recipe URL fixture.
		"http://localhost:4321/recipes/greek-turkey-patties/?servings=6&units=metric&starch=",
	);
});

it("collection print links carry servings, units and every selected side in that collection", () => {
	const recipes = [
		{ ...recipe, type: "meal" },
		{
			id: "shawarma-chicken-bowls",
			type: "meal",
			familyOptions: [{ id: "rice_one" }],
		},
		{
			id: "berry-smoothie",
			type: "smoothie",
			familyOptions: [{ id: "banana" }],
		},
	];
	const settings = {
		servings: 6,
		units: "grams",
		familyDiners: 2,
		familyChoice: {
			[recipe.id]: "pita_one",
			"berry-smoothie": "banana",
			"shawarma-chicken-bowls": "missing",
		},
	};
	const links = safariPrintLinks(
		collectionHref("meal", settings, recipes),
		"https://preview.example.test",
	);
	const url = new URL(links.url);
	assert.equal(url.pathname, "/recipes/meals/");
	assert.equal(links.safari, `x-safari-${links.url}`);
	assert.deepEqual(readRecipeURL(url, recipes), {
		servings: 6,
		units: "grams",
		familyDiners: 2,
		familyChoice: { [recipe.id]: "pita_one" },
		recipeId: "",
	});
	assert.equal(
		new URL(
			collectionHref("smoothie", { servings: 4, units: "us" }, recipes),
			"https://x.test",
		).href,
		// biome-ignore lint/security/noSecrets: public recipe URL fixture.
		"https://x.test/recipes/smoothies/?servings=4&units=us&starch=",
	);
});

it("a collection print link replaces Safari's own saved sides for that collection only", () => {
	const recipes = [
		{ ...recipe, type: "meal" },
		{
			id: "shawarma-chicken-bowls",
			type: "meal",
			familyOptions: [{ id: "rice_one" }],
		},
		{
			id: "berry-smoothie",
			type: "smoothie",
			familyOptions: [{ id: "banana" }],
		},
	];
	// Safari keeps its own storage, apart from the Home Screen app's.
	const safari = {
		servings: 2,
		familyDiners: 1,
		familyChoice: {
			"shawarma-chicken-bowls": "rice_one",
			"berry-smoothie": "banana",
		},
	};
	const app = {
		servings: 4,
		units: "us",
		familyDiners: 2,
		familyChoice: { [recipe.id]: "pita_one" },
	};
	const url = new URL(collectionHref("meal", app, recipes), "https://x.test");
	assert.deepEqual(readRecipeURL(url, recipes, safari), {
		servings: 4,
		units: "us",
		familyDiners: 2,
		familyChoice: { [recipe.id]: "pita_one", "berry-smoothie": "banana" },
		recipeId: "",
	});
	const none = new URL(
		collectionHref("meal", { servings: 4, units: "us" }, recipes),
		"https://x.test",
	);
	assert.deepEqual(readRecipeURL(none, recipes, safari).familyChoice, {
		"berry-smoothie": "banana",
	});
	// A native browse link carries servings but no starch, so saved sides stay.
	assert.deepEqual(
		readRecipeURL(
			// biome-ignore lint/security/noSecrets: public collection browse URL, not a credential.
			new URL("/recipes/meals/?servings=4&page=2", "https://x.test"),
			recipes,
			safari,
		).familyChoice,
		safari.familyChoice,
	);
});
