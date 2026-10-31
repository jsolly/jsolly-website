import assert from "node:assert/strict";
import { resolve } from "node:path";
import { globby } from "globby";
import { it } from "vitest";
import recipeData from "../../src/components/recipes/recipes.json" with {
	type: "json",
};
import retiredRecipes from "../../src/components/recipes/retired-recipes.json" with {
	type: "json",
};
import retiredCategories from "../../src/lib/blog/retired-categories.json" with {
	type: "json",
};
import { builtPages, SAMPLE } from "../accessibility-pages.mjs";
import { DIST } from "./pages.mjs";

// PR CI audits only SAMPLE; the full audit runs after merge and daily.
it("every sampled accessibility route is a page the full audit scans", async () => {
	const pages = new Set(await builtPages(resolve(DIST)));
	const routes = SAMPLE.map(({ route }) => route);
	assert.equal(new Set(routes).size, routes.length, "Duplicate sampled route");
	assert.deepEqual(
		routes.filter((route) => !pages.has(route)),
		[],
		"Sampled routes missing from dist/: update SAMPLE in scripts/accessibility-pages.mjs",
	);
});

it("the accessibility sample covers every HTML page template", async () => {
	const templates = await globby("src/pages/**/*.astro");
	assert.deepEqual(
		new Set(SAMPLE.map(({ template }) => template)),
		new Set(templates),
		"Each src/pages template needs a sampled route in scripts/accessibility-pages.mjs",
	);
});

// Templates that render distinct variants keep one sampled route per variant.
it("the accessibility sample keeps each recipe and category page variant", () => {
	const routesOf = (template) =>
		SAMPLE.filter((entry) => entry.template === template).map(
			({ route }) => route,
		);
	const slug = (route) => route.split("/").at(-2);
	const recipes = routesOf("src/pages/recipes/[slug].astro").map(slug);
	const originals = new Set(
		recipeData.recipes
			.map(({ id }) => id)
			.filter((id) => !id.startsWith("source-")),
	);
	const sources = new Set(
		recipeData.recipes
			.map(({ id }) => id)
			.filter((id) => id.startsWith("source-")),
	);
	const retired = new Set(retiredRecipes.map(({ id }) => id));
	assert.deepEqual(
		[originals, sources, retired].map(
			(variant) => recipes.filter((id) => variant.has(id)).length,
		),
		[1, 1, 1],
		`Recipe sample ${recipes.join(", ")} needs one original, one source- and one retired recipe`,
	);
	assert.equal(recipes.length, 3);
	const categories = routesOf("src/pages/blog/category/[slug].astro").map(slug);
	const retiredSlugs = new Set(retiredCategories.map(({ slug: s }) => s));
	assert.deepEqual(
		[
			categories.filter((c) => !retiredSlugs.has(c)).length,
			categories.filter((c) => retiredSlugs.has(c)).length,
		],
		[1, 1],
		`Category sample ${categories.join(", ")} needs one active and one retired category`,
	);
});
