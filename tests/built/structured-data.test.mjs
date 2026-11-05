import assert from "node:assert/strict";
import { it } from "vitest";
import recipeData from "../../src/components/recipes/recipes.json" with {
	type: "json",
};
import retiredRecipes from "../../src/components/recipes/retired-recipes.json" with {
	type: "json",
};
import {
	categorySlugs,
	publishedPosts,
	readBuilt,
	routeManifest,
} from "./pages.mjs";

const SITE = "https://www.jsolly.com";
const scripts = (document) =>
	[...document.querySelectorAll('script[type="application/ld+json"]')].map(
		(script) => JSON.parse(script.textContent),
	);

it("every indexable site page carries one connected WebSite, Organization and Person graph", async () => {
	await Promise.all(
		(await routeManifest()).map(async (path) => {
			const page = await readBuilt(path, (document) => ({
				noindex: document
					// biome-ignore lint/security/noSecrets: static CSS selector, not a credential
					.querySelector('meta[name="robots"]')
					?.content.includes("noindex"),
				graphs: scripts(document).filter((value) => value["@graph"]),
			}));
			// The graph is harmless on noindex notices; only indexable pages are required.
			assert.ok(page.noindex || page.graphs.length === 1, path);
			for (const graph of page.graphs) {
				assert.deepEqual(
					graph["@graph"].map((node) => [node["@type"], node["@id"]]),
					[
						["WebSite", `${SITE}/#website`],
						["Organization", `${SITE}/#organization`],
						["Person", `${SITE}/#person`],
					],
				);
			}
		}),
	);
});

it("post, category and published recipe breadcrumb JSON-LD matches the visible navigation", async () => {
	const paths = [
		...(await publishedPosts()).map((post) => `/blog/${post.slug}/`),
		...(await categorySlugs()).map((slug) => `/blog/category/${slug}/`),
		...recipeData.recipes.map((recipe) => `/recipes/${recipe.id}/`),
	];
	await Promise.all(
		paths.map(async (path) => {
			const page = await readBuilt(path, (document) => ({
				crumbs: [
					...document.querySelectorAll(
						'.breadcrumbs a, .breadcrumbs [aria-current="page"]',
					),
				].map((node) => ({
					name: node.textContent,
					item: node.getAttribute("href")
						? new URL(node.getAttribute("href"), SITE).href
						: `${SITE}${path}`,
				})),
				lists: scripts(document).filter(
					(value) => value["@type"] === "BreadcrumbList",
				),
			}));
			assert.equal(page.lists.length, 1, path);
			assert.deepEqual(
				page.lists[0].itemListElement.map(({ name, item }) => ({ name, item })),
				page.crumbs,
				path,
			);
			assert.equal(page.crumbs[0].name, "Home");
			assert.equal(page.crumbs[0].item, `${SITE}/`);
		}),
	);
});

it("all published recipes emit Recipe data and retired notices emit none", async () => {
	await Promise.all(
		recipeData.recipes.map(async (recipe) => {
			const values = await readBuilt(`/recipes/${recipe.id}/`, scripts);
			const recipes = values.filter((value) => value["@type"] === "Recipe");
			assert.equal(recipes.length, 1, recipe.id);
			assert.equal(recipes[0].name, recipe.title);
			assert.equal(recipes[0].image.url, `${SITE}${recipe.image.src}`);
			assert.equal(
				recipes[0].mainEntityOfPage["@id"],
				`${SITE}/recipes/${recipe.id}/`,
			);
		}),
	);
	await Promise.all(
		retiredRecipes.map(async (recipe) => {
			const values = await readBuilt(`/recipes/${recipe.id}/`, scripts);
			assert.equal(
				values.filter((value) => value["@type"] === "Recipe").length,
				0,
				recipe.id,
			);
		}),
	);
});
