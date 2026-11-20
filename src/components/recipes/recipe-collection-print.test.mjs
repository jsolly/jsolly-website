import assert from "node:assert/strict";
import { it } from "vitest";
import { loadCollection, loadRecipePacks } from "./recipe-collection-print.mjs";
import data from "./recipe-data.server.mjs";
import { loadRecipePack } from "./recipe-pack.mjs";

const PACK_ID = /packs\/(?<id>[^/]+)\.json$/u;
const LOAD_FAILED = /could not be loaded/u;
const payload = (recipe, releaseId) => ({
	schemaVersion: 1,
	releaseId,
	recipe,
});
const loadIndex = (id) => Promise.resolve({ id });

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
		(id) => loadRecipePack(id, release, { fetcher }),
		{
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
			(id) => loadRecipePack(id, release, { fetcher }),
			{ concurrency: 1 },
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
			(id) => loadRecipePack(id, release, { fetcher }),
			{
				concurrency: 3,
				onProgress: (loaded, total) => progress.push([loaded, total]),
			},
		),
		LOAD_FAILED,
	);
	// The downloads still in flight share the cached requests: wait for them,
	// then one more turn, so a late progress report would have arrived.
	await Promise.all(
		chosen
			.slice(1, 3)
			.map((recipe) => loadRecipePack(recipe.id, release, { fetcher })),
	);
	await Promise.resolve();
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
			(id) => loadRecipePack(id, release, { fetcher }),
			{
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

it("Print all loads every meal in canonical order and reports progress in meal words", async () => {
	const meals = data.recipes.filter((recipe) => recipe.type === "meal");
	const messages = [];
	const loaded = await loadCollection(data.recipes, "meal", loadIndex, {
		onMessage: (text) => messages.push(text),
	});
	assert.deepEqual(
		loaded.map((recipe) => recipe.id),
		meals.map((recipe) => recipe.id),
	);
	assert.equal(messages[0], `Loading ${meals.length} meals for printing…`);
	assert.equal(
		messages.at(-1),
		`Loading meals for printing: ${meals.length} of ${meals.length}…`,
	);
	assert.equal(messages.length, meals.length + 1);
});

it("Print all smoothies loads only smoothies and reports progress in smoothie words", async () => {
	const smoothies = data.recipes.filter((recipe) => recipe.type === "smoothie");
	const messages = [];
	const loaded = await loadCollection(data.recipes, "smoothie", loadIndex, {
		onMessage: (text) => messages.push(text),
	});
	assert.deepEqual(
		loaded.map((recipe) => recipe.id),
		smoothies.map((recipe) => recipe.id),
	);
	assert.deepEqual(messages.slice(0, 2), [
		`Loading ${smoothies.length} smoothies for printing…`,
		`Loading smoothies for printing: 1 of ${smoothies.length}…`,
	]);
});

it("an already-aborted Print all rejects without writing a message or loading anything", async () => {
	const stopped = new AbortController();
	stopped.abort();
	const messages = [];
	const requested = [];
	await assert.rejects(
		loadCollection(
			data.recipes,
			"smoothie",
			(id) => {
				requested.push(id);
				return loadIndex(id);
			},
			{ signal: stopped.signal, onMessage: (text) => messages.push(text) },
		),
		{ name: "AbortError" },
	);
	assert.deepEqual(messages, []);
	assert.deepEqual(requested, []);
});
