import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { exists, readBuilt } from "./pages.mjs";

// The built recipe routes without JavaScript (ported from awesome-blog's
// astro-contract test): the /recipes/ landing renders the library unhydrated
// with no recipe open, the meals and smoothies pages list their collection's
// cards linking to each recipe page, every recipe page renders its whole body
// with its first-party images, and the assistant downloads list every recipe.
const DIST = "dist";
const RECIPES = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const WHITESPACE = /\s+/u;
const COLLECTIONS = { meals: "meal", smoothies: "smoothie" };

it("recipe route shares complete recipe bodies without JavaScript and retains first-party assets", async () => {
	const { recipes } = JSON.parse(await readFile(RECIPES, "utf8"));
	assert.deepEqual(
		await readBuilt("recipes", (document) => ({
			headings: document.querySelectorAll("h1:not(.print-title)").length,
			hero: document.querySelectorAll(".article-hero, #print-article").length,
			hydrated: document
				.querySelector(".meal-library")
				?.getAttribute("data-hydrated"),
			openRecipes: document.querySelectorAll(".recipe-detail").length,
		})),
		{ headings: 1, hero: 0, hydrated: "false", openRecipes: 0 },
		"the /recipes/ landing",
	);
	assert.ok(
		Buffer.byteLength(
			await readFile(join(DIST, "recipes/index.html"), "utf8"),
		) <= 200_000,
		"the recipe landing HTML fits the 200 KB initial HTML budget",
	);
	const collections = await Promise.all(
		Object.entries(COLLECTIONS).map(async ([collection, type]) => {
			const expected = recipes
				.filter((recipe) => recipe.type === type)
				.slice(0, 6);
			const html = await readFile(
				join(DIST, "recipes", collection, "index.html"),
				"utf8",
			);
			assert.ok(
				Buffer.byteLength(html) <= 200_000,
				`${collection} HTML fits the 200 KB initial HTML budget`,
			);
			const counts = await readBuilt(`recipes/${collection}`, (document) => ({
				printMeals: document.querySelectorAll(".print-meal").length,
				cards: document.querySelectorAll(".recipe-card").length,
				linked: expected.filter(
					(recipe) =>
						document.querySelectorAll(
							`a.title-button[href^="/recipes/${recipe.id}/"]`,
						).length === 1,
				).length,
			}));
			return { collection, ...counts, expected: expected.length };
		}),
	);
	assert.deepEqual(
		collections,
		collections.map(({ collection, expected }) => ({
			collection,
			printMeals: 0,
			cards: expected,
			linked: expected,
			expected,
		})),
		"each collection page starts with the first six canonical recipes",
	);
	const details = await Promise.all(
		recipes.map(async (recipe) => {
			const page = await readBuilt(`recipes/${recipe.id}`, (document) => {
				const body = document.querySelector(".recipe-body")?.textContent ?? "";
				return {
					detail: document.querySelectorAll(".recipe-detail").length,
					flow: document.querySelectorAll(".recipe-body .trn-table").length,
					disclosure: document.querySelectorAll("details.nutrient-disclosure")
						.length,
					photo: document
						.querySelector(".recipe-photo img")
						?.getAttribute("src"),
					missingIngredients: recipe.ingredients
						.filter((ingredient) => !body.includes(ingredient.name))
						.map((ingredient) => ingredient.name),
				};
			});
			const candidates = [recipe.image.cardSrcset, recipe.image.detailSrcset]
				.flatMap((srcset) => srcset.split(","))
				.map((candidate) => candidate.trim().split(WHITESPACE)[0]);
			const present = await Promise.all(
				candidates.map((candidate) => exists(join(DIST, candidate))),
			);
			return {
				id: recipe.id,
				...page,
				missingImages: candidates.filter((_candidate, i) => !present[i]),
			};
		}),
	);
	assert.deepEqual(
		details,
		recipes.map((recipe) => ({
			id: recipe.id,
			detail: 1,
			flow: 1,
			disclosure: 1,
			photo: recipe.image.src,
			missingIngredients: [],
			missingImages: [],
		})),
		"each recipe page renders its whole body and its images exist",
	);
	const assistant = JSON.parse(
		await readFile(join(DIST, "recipes/data/recipe-library.json"), "utf8"),
	);
	assert.deepEqual(
		assistant.recipes.map((recipe) => recipe.recipeId),
		recipes.map((recipe) => recipe.id),
	);
	assert.ok(
		await exists(join(DIST, "recipes/data/recipe-library.md")),
		"the Markdown library ships",
	);
});
