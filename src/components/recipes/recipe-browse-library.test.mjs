import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { beforeAll, it } from "vitest";
import { SERVING_CHOICES } from "./constants.mjs";
import { filterBrowseRecipes, parseBrowseParams } from "./recipe-browse.mjs";
import {
	browseLibraryPath,
	loadBrowseLibrary,
	parseBrowseLibrary,
} from "./recipe-browse-library.mjs";
import {
	buildBrowseLibrary,
	buildBrowseSearch,
} from "./recipe-browse-library.server.mjs";
import {
	browseLibraryState,
	browseSearchPath,
	loadBrowseSearch,
	parseBrowseSearch,
} from "./recipe-browse-search.mjs";
import data from "./recipe-data.server.mjs";
import { createBrowsePage } from "./recipe-summary.mjs";

const REGISTRY =
	/(?:^|\/)(?:recipes|nutrition-data|ingredient-weights)\.json$/u;
const LOAD_ERROR = /could not be loaded/u;
const MISMATCH = /newer recipe library/u;
const INCOMPLETE = /incomplete/u;
const INVALID = /Invalid/u;
const release = "a".repeat(40);
let library;
let search;
beforeAll(() => {
	search = buildBrowseSearch(data.recipes, release);
	library = parseBrowseLibrary(
		JSON.parse(JSON.stringify(buildBrowseLibrary(data.recipes, release))),
		release,
	);
});

it("static summaries retain every collection, filter, serving size and full-text search result", () => {
	for (const collection of ["meal", "smoothie"])
		for (const servings of SERVING_CHOICES)
			for (const query of [
				"",
				"q=chicken",
				"q=vitamin",
				"q=oven",
				"proteinChoice=fish",
				"starchChoice=rice",
				"vegetarianOnly=1",
				"dumpAndGo=1",
				"immuneSupport=1",
				"ironRich=1",
				"omega3=1",
				"ingredientChoice=spinach",
				"appliance.Oven=0",
				// biome-ignore lint/security/noSecrets: public recipe search and shuffle fixture
				"q=chicken&seed=sample",
				"page=3",
			]) {
				const state = parseBrowseParams(
					new URLSearchParams(`${query}&servings=${servings}`),
					collection,
					data.recipes,
				);
				const projected = browseLibraryState(search, state);
				assert.deepEqual(
					filterBrowseRecipes(library.recipes, collection, projected).map(
						({ id }) => id,
					),
					filterBrowseRecipes(data.recipes, collection, state).map(
						({ id }) => id,
					),
					`${collection}/${servings}/${query}`,
				);
				assert.deepEqual(
					createBrowsePage(library.recipes, collection, projected, release),
					createBrowsePage(data.recipes, collection, state, release),
					`${collection}/${servings}/${query}`,
				);
			}
});

it("summary artifacts contain no cooking instructions or nutrient calculation registries", () => {
	assert.ok(
		gzipSync(JSON.stringify(library)).length <= 30_000,
		"the complete summary download stays within the production gzip budget",
	);
	assert.equal(library.recipes.length, data.recipes.length);
	for (const recipe of library.recipes) {
		for (const field of [
			"calculation",
			"flow",
			"steps",
			"nutrition",
			"summary",
			"sharedTable",
		])
			assert.equal(Object.hasOwn(recipe, field), false, field);
		assert.ok(
			recipe.ingredients.every(
				(ingredient) => Object.keys(ingredient).sort().join() === "id,name",
			),
		);
	}
	assert.equal(Object.hasOwn(library, "indexes"), false);
});

it("the browse API bundles no canonical recipes, nutrition data or ingredient weight registry", async () => {
	const result = await build({
		entryPoints: ["api/recipe-browse.mjs"],
		bundle: true,
		platform: "node",
		write: false,
		metafile: true,
		logLevel: "silent",
	});
	assert.ok(
		Object.keys(result.metafile.inputs).every((path) => !REGISTRY.test(path)),
	);
});

it("downloads are shared by release and use an immutable release-named static path", async () => {
	const ownRelease = "b".repeat(40);
	let count = 0;
	const url = `${browseLibraryPath(ownRelease)}?dpl=dpl_summaryTest`;
	const fetcher = (path) => {
		count++;
		assert.equal(path, url);
		return Response.json({ ...library, release: ownRelease });
	};
	const [first, second] = await Promise.all([
		loadBrowseLibrary(ownRelease, { fetcher, url }),
		loadBrowseLibrary(ownRelease, { fetcher, url }),
	]);
	assert.equal(first, second);

	assert.equal(count, 1);
	const searchURL = `${browseSearchPath(ownRelease)}?dpl=dpl_summaryTest`;
	const fetchSearch = (path) => {
		assert.equal(path, searchURL);
		count++;
		return Response.json({ ...search, release: ownRelease });
	};
	const [index, sharedIndex] = await Promise.all([
		loadBrowseSearch(ownRelease, { fetcher: fetchSearch, url: searchURL }),
		loadBrowseSearch(ownRelease, { fetcher: fetchSearch, url: searchURL }),
	]);
	assert.equal(index, sharedIndex);
	assert.equal(count, 2, "summary and optional search each download once");
});

it("failed downloads can be retried without mixing releases or accepting malformed projections", async () => {
	const ownRelease = "c".repeat(40);
	await assert.rejects(
		loadBrowseLibrary(ownRelease, {
			fetcher: () => new Response("unavailable", { status: 503 }),
		}),
		LOAD_ERROR,
	);
	const restored = await loadBrowseLibrary(ownRelease, {
		fetcher: () => Response.json({ ...library, release: ownRelease }),
	});
	assert.equal(restored.release, ownRelease);
	assert.throws(() => parseBrowseLibrary(library, "d".repeat(40)), MISMATCH);
	assert.throws(
		() =>
			parseBrowseLibrary(
				{ ...library, recipes: [library.recipes[0], library.recipes[0]] },
				release,
			),
		INCOMPLETE,
	);
	assert.throws(
		() =>
			parseBrowseSearch(
				{ ...buildBrowseSearch(data.recipes, release), searchIndexes: {} },
				release,
			),
		INCOMPLETE,
	);
	await assert.rejects(
		loadBrowseLibrary("d".repeat(40), {
			fetcher: () => new Response("missing", { status: 404 }),
		}),
		(error) => error.code === "RECIPE_RELEASE_MISMATCH",
	);
	await assert.rejects(
		loadBrowseSearch("e".repeat(40), {
			fetcher: () => new Response("missing", { status: 404 }),
		}),
		(error) => error.code === "RECIPE_RELEASE_MISMATCH",
	);
	assert.throws(() => parseBrowseSearch(search, "f".repeat(40)), MISMATCH);
	assert.throws(() => browseLibraryPath("../other"), INVALID);
	assert.throws(
		() =>
			loadBrowseLibrary(ownRelease, { url: "https://other.test/library.json" }),
		INVALID,
	);
});
