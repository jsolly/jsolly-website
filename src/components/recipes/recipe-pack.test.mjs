import assert from "node:assert/strict";
import { it } from "vitest";
import data from "./recipe-data.server.mjs";
import { recipeDocument } from "./recipe-export.mjs";
import {
	loadRecipePack,
	loadRecipePacks,
	recipeFromPack,
} from "./recipe-pack.mjs";

const RELEASE = "1".repeat(40);
const PACK_ID = /packs\/(?<id>[^/]+)\.json$/u;
const LOAD_FAILED = /could not be loaded/u;
const payload = (recipe, releaseId = RELEASE) => ({
	schemaVersion: 1,
	releaseId,
	recipe,
});

it("each serialized detail pack calculates with only its own nutrient rows and ingredient references", () => {
	for (const recipe of data.recipes) {
		const restored = recipeFromPack(
			JSON.parse(JSON.stringify(payload(recipe))),
			recipe.id,
			RELEASE,
		);
		assert.ok(
			restored.calculation.rows.every((row) =>
				restored.ingredients.some(
					(ingredient) => ingredient.id === row.ingredientId,
				),
			),
		);
		assert.equal(restored.calculation.recipes, undefined);
		for (const settings of [
			{ servings: 2, units: "grams" },
			{ servings: 8, units: "metric" },
		])
			assert.deepEqual(
				recipeDocument(restored, settings),
				recipeDocument(recipe, settings),
			);
	}
});

it("detail downloads reject a mismatched release, wrong recipe, and missing calculation context", () => {
	const recipe = data.recipes[0];
	assert.throws(
		() => recipeFromPack(payload(recipe, "2".repeat(40)), recipe.id, RELEASE),
		{ code: "RECIPE_RELEASE_MISMATCH", status: 409 },
	);
	assert.throws(() => recipeFromPack(payload(recipe), "wrong-recipe", RELEASE));
	assert.throws(() =>
		recipeFromPack(
			payload({ ...recipe, calculation: undefined }),
			recipe.id,
			RELEASE,
		),
	);
});

it("repeated prints of one recipe share one request and reuse the downloaded pack", async () => {
	const recipe = data.recipes[1];
	let finish;
	let calls = 0;
	const fetcher = () => {
		calls++;
		return new Promise((resolve) => {
			finish = () => resolve(Response.json(payload(recipe)));
		});
	};
	const first = loadRecipePack(recipe.id, RELEASE, { fetcher });
	const second = loadRecipePack(recipe.id, RELEASE, { fetcher });
	finish();
	assert.deepEqual(
		[(await first).id, (await second).id],
		[recipe.id, recipe.id],
	);
	assert.equal(
		(await loadRecipePack(recipe.id, RELEASE, { fetcher })).id,
		recipe.id,
	);
	assert.equal(calls, 1);
});

it("failed detail downloads can retry without caching the error or mixing releases", async () => {
	const recipe = data.recipes[2];
	let calls = 0;
	const fetcher = () => {
		calls++;
		return Promise.resolve(
			calls === 1
				? new Response("", { status: 503 })
				: Response.json(payload(recipe)),
		);
	};
	await assert.rejects(loadRecipePack(recipe.id, RELEASE, { fetcher }));
	assert.equal(
		(await loadRecipePack(recipe.id, RELEASE, { fetcher })).id,
		recipe.id,
	);
	assert.equal(calls, 2);
	await assert.rejects(loadRecipePack(recipe.id, "3".repeat(40), { fetcher }), {
		code: "RECIPE_RELEASE_MISMATCH",
	});
	assert.equal(calls, 3);
});

it("collection printing loads every pack in order with bounded concurrent downloads", async () => {
	const release = "4".repeat(40);
	const chosen = data.recipes.slice(0, 9);
	let open = 0;
	let peak = 0;
	const progress = [];
	const fetcher = async (url) => {
		open++;
		peak = Math.max(peak, open);
		await new Promise((resolve) => setTimeout(resolve, 1));
		open--;
		const id = PACK_ID.exec(url).groups.id;
		return Response.json(
			payload(
				chosen.find((recipe) => recipe.id === id),
				release,
			),
		);
	};
	const recipes = await loadRecipePacks(
		chosen.map((recipe) => recipe.id),
		release,
		{
			fetcher,
			concurrency: 3,
			onProgress: (loaded, total) => progress.push([loaded, total]),
		},
	);
	assert.deepEqual(
		recipes.map((recipe) => recipe.id),
		chosen.map((recipe) => recipe.id),
	);
	assert.equal(peak, 3);
	assert.deepEqual(
		progress,
		chosen.map((_, index) => [index + 1, chosen.length]),
	);
});

it("collection printing stops starting downloads after the first failure", async () => {
	const release = "5".repeat(40);
	const chosen = data.recipes.slice(0, 8);
	const requested = [];
	const fetcher = (url) => {
		requested.push(url);
		if (requested.length === 2)
			return Promise.resolve(new Response("", { status: 503 }));
		const id = PACK_ID.exec(url).groups.id;
		return Promise.resolve(
			Response.json(
				payload(
					chosen.find((recipe) => recipe.id === id),
					release,
				),
			),
		);
	};
	await assert.rejects(
		loadRecipePacks(
			chosen.map((recipe) => recipe.id),
			release,
			{ fetcher, concurrency: 1 },
		),
		LOAD_FAILED,
	);
	assert.equal(requested.length, 2);
});

it("collection printing reports no progress after a failure, even from downloads still in flight", async () => {
	const release = "6".repeat(40);
	const chosen = data.recipes.slice(0, 4);
	const requested = [];
	const progress = [];
	const fetcher = (url) => {
		requested.push(url);
		const id = PACK_ID.exec(url).groups.id;
		if (id === chosen[0].id)
			return Promise.resolve(new Response("", { status: 503 }));
		const recipe = chosen.find((item) => item.id === id);
		return new Promise((resolve) => {
			setTimeout(() => resolve(Response.json(payload(recipe, release))), 10);
		});
	};
	await assert.rejects(
		loadRecipePacks(
			chosen.map((recipe) => recipe.id),
			release,
			{
				fetcher,
				concurrency: 3,
				onProgress: (loaded, total) => progress.push([loaded, total]),
			},
		),
		LOAD_FAILED,
	);
	await new Promise((resolve) => {
		setTimeout(resolve, 40);
	});
	assert.deepEqual(progress, [], "the error is the last word");
	assert.equal(requested.length, 3, "no download starts after the failure");
});

it("an aborted collection print starts no more downloads and reports no more progress", async () => {
	const release = "7".repeat(40);
	const chosen = data.recipes.slice(0, 4);
	const requested = [];
	const progress = [];
	const loading = new AbortController();
	const fetcher = (url) => {
		requested.push(url);
		const id = PACK_ID.exec(url).groups.id;
		loading.abort();
		return Promise.resolve(
			Response.json(
				payload(
					chosen.find((recipe) => recipe.id === id),
					release,
				),
			),
		);
	};
	await assert.rejects(
		loadRecipePacks(
			chosen.map((recipe) => recipe.id),
			release,
			{
				fetcher,
				concurrency: 1,
				signal: loading.signal,
				onProgress: (loaded, total) => progress.push([loaded, total]),
			},
		),
		{ name: "AbortError" },
	);
	assert.equal(requested.length, 1);
	assert.deepEqual(progress, []);
});
