import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { JSDOM } from "jsdom";
import { browseResponse } from "../../../api/recipe-browse.mjs";
import { filterBrowseRecipes, parseBrowseParams } from "./recipe-browse.mjs";
import data from "./recipe-data.server.mjs";
import { createBrowsePage } from "./recipe-summary.mjs";

const release = "a".repeat(40);
let directory;
let root;
before(async () => {
	directory = await mkdtemp(join(tmpdir(), "recipe-browse-"));
	root = join(directory, "recipes");
	await mkdir(root);
	await writeFile(
		join(directory, "release.json"),
		JSON.stringify({ sha: release }),
	);
});
after(async () => {
	await rm(directory, { recursive: true, force: true });
});
const request = (query = "", options = {}) =>
	new Request(
		`https://example.test/api/recipe-browse/?path=/recipes/meals/&${query}`,
		{ headers: { accept: "application/json" }, ...options },
	);

it("browse JSON exposes six summaries and searches the entire recipe collection", async () => {
	const response = await browseResponse(request(`release=${release}`), root);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("vary"), "Accept");
	const body = await response.json();
	assert.equal(body.release, release);
	assert.equal(body.cards.length, 6);
	assert.equal(body.nextPage, 2);
	assert.equal(
		body.total,
		data.recipes.filter((recipe) => recipe.type === "meal").length,
	);
	for (const card of body.cards) {
		for (const forbidden of [
			"ingredients",
			"flow",
			"nutrition",
			"calculation",
			"nutritionByIngredient",
			"instructions",
		])
			assert.equal(Object.hasOwn(card, forbidden), false, forbidden);
	}
	const target = data.recipes.filter((recipe) => recipe.type === "meal").at(-1);
	const searched = await browseResponse(
		request(`q=${encodeURIComponent(target.title)}`),
		root,
	);
	assert.ok(
		(await searched.json()).cards.some((card) => card.id === target.id),
	);
});

it("browse JSON pins releases and reports failures and maintenance with JSON status", async () => {
	const changed = await browseResponse(
		request(`release=${"b".repeat(40)}`),
		root,
	);
	assert.equal(changed.status, 409);
	assert.equal((await changed.json()).release, release);
	const missing = await browseResponse(
		request(),
		join(directory, "missing/recipes"),
	);
	assert.equal(missing.status, 503);
	assert.ok((await missing.json()).error);
	const old = process.env.MAINTENANCE_MODE;
	try {
		process.env.MAINTENANCE_MODE = "true";
		const maintenance = await browseResponse(request(), root);
		assert.equal(maintenance.status, 503);
		assert.ok((await maintenance.json()).error);
	} finally {
		if (old === undefined) delete process.env.MAINTENANCE_MODE;
		else process.env.MAINTENANCE_MODE = old;
	}
	const head = await browseResponse(
		request("", { method: "HEAD", headers: { accept: "application/json" } }),
		root,
	);
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
});

it("JSON shuffle returns a seed that preserves order across pages and clamps the last page", async () => {
	const shuffled =
		await // biome-ignore lint/security/noSecrets: public shuffle and pagination query
		(await browseResponse(request("shuffle=1&page=4"), root)).json();
	assert.equal(shuffled.page, 1);
	assert.ok(shuffled.seed);
	const state = parseBrowseParams(
		new URLSearchParams({ seed: shuffled.seed }),
		"meal",
		data.recipes,
	);
	const expected = filterBrowseRecipes(data.recipes, "meal", state).map(
		(recipe) => recipe.id,
	);
	assert.deepEqual(
		shuffled.cards.map((recipe) => recipe.id),
		expected.slice(0, 6),
	);
	const second = await (
		await browseResponse(request(`seed=${shuffled.seed}&page=2`), root)
	).json();
	assert.deepEqual(
		second.cards.map((recipe) => recipe.id),
		expected.slice(6, 12),
	);
	const last = await (
		await browseResponse(request(`seed=${shuffled.seed}&page=999`), root)
	).json();
	assert.equal(last.page, Math.ceil(expected.length / 6));
	assert.equal(last.nextPage, null);
});

it("filter availability remains based on the full collection and current filters", () => {
	const state = parseBrowseParams(
		new URLSearchParams({ q: "zzznomatch", proteinChoice: "fish" }),
		"meal",
		data.recipes,
	);
	const result = createBrowsePage(data.recipes, "meal", state, release);
	assert.equal(result.total, 0);
	assert.equal(result.filterChoices.proteinChoice.chicken, true);
	assert.ok(result.filterChoices.shownAppliances.includes("Oven"));
	assert.ok(Object.keys(result.filterChoices.smoothieIngredients).length);
});

it("native pagination renders every recipe from private build fragments despite a six-card template", async () => {
	const meals = data.recipes.filter((recipe) => recipe.type === "meal");
	const card = (recipe) =>
		`<article class="recipe-card"><a data-recipe-id="${recipe.id}" href="/recipes/${recipe.id}/">${recipe.id}</a></article>`;
	const fragmentRoot = join(directory, "fragments");
	await mkdir(fragmentRoot);
	await mkdir(join(root, "meals"));
	await writeFile(
		join(fragmentRoot, "meal.json"),
		JSON.stringify({
			release,
			cards: {
				4: Object.fromEntries(meals.map((recipe) => [recipe.id, card(recipe)])),
			},
		}),
	);
	await writeFile(
		join(root, "meals/index.html"),
		`<html><head><meta name="robots" content="index, follow"></head><body><astro-island><section class="meal-library"><div class="library-controls"><nav class="collection-options"></nav></div><noscript><form id="recipe-browse-form" action="/recipes/meals/"><input name="q"><input name="seed"></form></noscript><div id="meal-results"><div class="recipe-grid">${meals.slice(0, 6).map(card).join("")}</div><p class="no-results"></p></div></section></astro-island></body></html>`,
	);
	const ids = [];
	let query = "seed=native-pages";
	do {
		// biome-ignore lint/performance/noAwaitInLoops: each page supplies the next URL
		const response = await browseResponse(
			request(query, { headers: { accept: "text/html" } }),
			root,
			fragmentRoot,
		);
		assert.equal(response.status, 200);
		const dom = new JSDOM(await response.text());
		const document = dom.window.document;
		const cards = [
			...document.querySelectorAll(".recipe-card [data-recipe-id]"),
		];
		assert.ok(cards.length <= 6);
		ids.push(...cards.map((link) => link.dataset.recipeId));
		assert.equal(document.querySelector("astro-island"), null);
		const next = [...document.querySelectorAll(".recipe-pagination a")].find(
			(link) => link.textContent === "Next recipes",
		);
		query = next
			? new URL(next.href, "https://example.test").searchParams.toString()
			: "";
		dom.window.close();
	} while (query);
	const expected = filterBrowseRecipes(
		data.recipes,
		"meal",
		parseBrowseParams(
			new URLSearchParams("seed=native-pages"),
			"meal",
			data.recipes,
		),
	);
	assert.deepEqual(
		ids,
		expected.map((recipe) => recipe.id),
	);
	assert.equal(new Set(ids).size, meals.length);
});
