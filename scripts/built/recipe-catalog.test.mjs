import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "vitest";
import { readBuilt } from "./pages.mjs";

const { recipes } = JSON.parse(
	await readFile(
		new URL("../../src/components/recipes/recipes.json", import.meta.url),
		"utf8",
	),
);

it("every published recipe is crawlable in the static catalog and its ItemList", async () => {
	const actual = await readBuilt("recipes/all", (document) => ({
		links: [...document.querySelectorAll(".recipe-catalog a")].map((link) =>
			link.getAttribute("href"),
		),
		items: [...document.querySelectorAll('script[type="application/ld+json"]')]
			.map(({ textContent }) => JSON.parse(textContent))
			.find((item) => item["@type"] === "ItemList"),
		canonical: [...document.querySelectorAll("link")]
			.find((link) => link.getAttribute("rel") === "canonical")
			?.getAttribute("href"),
		islands: document.querySelectorAll(".recipe-catalog astro-island").length,
	}));
	const expected = ["meal", "smoothie"].flatMap((type) =>
		recipes
			.filter((recipe) => recipe.type === type)
			.map(({ id }) => `/recipes/${id}/`),
	);
	assert.deepEqual(actual.links, expected);
	assert.equal(actual.canonical, "https://www.jsolly.com/recipes/all/");
	assert.equal(actual.islands, 0);
	assert.ok(
		actual.items,
		"the recipe layout forwards the catalog ItemList into its head",
	);
	assert.deepEqual(
		actual.items.itemListElement.map(({ position, url }) => [position, url]),
		expected.map((href, index) => [index + 1, `https://www.jsolly.com${href}`]),
	);
	const sitemap = await readFile("dist/sitemap-0.xml", "utf8");
	assert.ok(sitemap.includes("https://www.jsolly.com/recipes/all/"));
});

it("the recipe landing distinguishes both collections and preserves legacy library anchors", async () => {
	const actual = await readBuilt("recipes", (document) => ({
		collections: [
			...document.querySelectorAll(".collection-overview h2 a"),
		].map((link) => link.getAttribute("href")),
		index: document.querySelector('main a[href="/recipes/all/"]')?.textContent,
		legacy: ["easy-meals--smoothies", "meal-results", "about-author"].map(
			(id) => Boolean(document.querySelector(`#${id}`)),
		),
		canonical: [...document.querySelectorAll("link")]
			.find((link) => link.getAttribute("rel") === "canonical")
			?.getAttribute("href"),
	}));
	assert.deepEqual(actual.collections, [
		"/recipes/meals/",
		"/recipes/smoothies/",
	]);
	assert.equal(actual.index, `Browse all ${recipes.length} recipes`);
	assert.deepEqual(actual.legacy, [true, true, true]);
	assert.equal(actual.canonical, "https://www.jsolly.com/recipes/");
	const collectionLinks = await Promise.all(
		["recipes/meals", "recipes/smoothies"].map((path) =>
			readBuilt(path, (document) =>
				Boolean(document.querySelector('main a[href="/recipes/all/"]')),
			),
		),
	);
	assert.deepEqual(collectionLinks, [true, true]);
});
