import assert from "node:assert/strict";
import { it } from "vitest";
import data from "./recipe-data.server.mjs";
import { recipeDocument } from "./recipe-export.mjs";
import { loadRecipePack, recipeFromPack } from "./recipe-pack.mjs";

const RELEASE = "1".repeat(40);
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
