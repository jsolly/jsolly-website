import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import {
	validateRecipeImage,
	webpDimensions,
} from "../../../scripts/recipes/image-contract.mjs";
import data from "./recipe-data.server.mjs";

const recipes = data.recipes;
const publicRoot = fileURLToPath(new URL("../../../public/", import.meta.url));
const IMAGE_ERROR_1 = /Missing recipe image/u;
const IMAGE_ERROR_2 = /styleVersion/u;
const IMAGE_ERROR_3 = /defining foods/u;
const IMAGE_ERROR_4 = /caption/u;
const IMAGE_ERROR_5 = /local 960/u;
const IMAGE_ERROR_6 = /Card src/u;
const IMAGE_ERROR_7 = /Detail width/u;
const IMAGE_ERROR_8 = /Detail height/u;
const IMAGE_ERROR_9 = /Card srcset/u;
const IMAGE_ERROR_10 = /Detail srcset/u;
const IMAGE_ERROR_11 = /local image family/u;
const IMAGE_ERROR_12 = /width descriptor/u;
const IMAGE_ERROR_13 = /Missing large responsive asset/u;
const IMAGE_ERROR_14 = /pixels must match/u;
const IMAGE_ERROR_15 = /not a WebP/u;
const IMAGE_ERROR_16 = /RIFF length/u;

function referenceRecipe() {
	const recipe = structuredClone(
		recipes.find(
			(candidate) => candidate.id === "lemon-chicken-potatoes-and-green-beans",
		),
	);
	if (!recipe)
		throw new Error(
			"The approved lemon-chicken style reference must remain available",
		);
	recipe.image.styleVersion = "warm-overhead-v1";
	return recipe;
}

it("image contract accepts the real responsive lemon-chicken assets", () => {
	assert.equal(validateRecipeImage(referenceRecipe()), true);
});

it("image contract rejects missing, generic, external and inconsistent metadata", () => {
	const cases = [
		[(recipe) => (recipe.image = undefined), IMAGE_ERROR_1],
		[(recipe) => (recipe.image.styleVersion = undefined), IMAGE_ERROR_2],
		[(recipe) => (recipe.image.styleVersion = "unreviewed-v2"), IMAGE_ERROR_2],
		[
			(recipe) =>
				(recipe.image.alt = "A delicious recipe image served on a plate."),
			IMAGE_ERROR_3,
		],
		[
			(recipe) =>
				(recipe.image.alt = "Illustration of salmon and asparagus on a plate."),
			IMAGE_ERROR_3,
		],
		[
			(recipe) => (recipe.image.caption = "Photograph of the cooked meal."),
			IMAGE_ERROR_4,
		],
		[
			(recipe) =>
				(recipe.image.src = "https://publisher.example/photo-960.webp"),
			IMAGE_ERROR_5,
		],
		[
			(recipe) => (recipe.image.src = "/recipes/media/../photo-960.webp"),
			IMAGE_ERROR_5,
		],
		[
			(recipe) => (recipe.image.src = "/recipes/media/photo.svg"),
			IMAGE_ERROR_5,
		],
		[(recipe) => (recipe.image.cardSrc = recipe.image.src), IMAGE_ERROR_6],
		[(recipe) => (recipe.image.width = 1440), IMAGE_ERROR_7],
		[(recipe) => (recipe.image.height = 960), IMAGE_ERROR_8],
		[
			(recipe) =>
				(recipe.image.cardSrcset = recipe.image.cardSrcset.replace(
					"480w",
					"960w",
				)),
			IMAGE_ERROR_9,
		],
		[
			(recipe) => (recipe.image.detailSrcset = recipe.image.cardSrcset),
			IMAGE_ERROR_10,
		],
		[
			(recipe) =>
				(recipe.image.detailSrcset = recipe.image.detailSrcset.replace(
					"/recipes/media/",
					"https://publisher.example/",
				)),
			IMAGE_ERROR_11,
		],
		[
			(recipe) =>
				(recipe.image.detailSrcset = recipe.image.detailSrcset.replace(
					"-1440.webp 1440w",
					"-960.webp 1440w",
				)),
			IMAGE_ERROR_12,
		],
	];
	for (const [mutate, message] of cases) {
		const recipe = referenceRecipe();
		mutate(recipe);
		assert.throws(() => validateRecipeImage(recipe), message);
	}
});

it("image contract rejects absent assets, wrong stored dimensions and corrupt WebP files", () => {
	const recipe = referenceRecipe();
	assert.throws(
		() =>
			validateRecipeImage(recipe, {
				readAsset: (path) => {
					if (path.endsWith("-1440.webp"))
						throw new Error("Missing large responsive asset");
					return readFileSync(path);
				},
			}),
		IMAGE_ERROR_13,
	);
	assert.throws(
		() =>
			validateRecipeImage(recipe, {
				readAsset: (path) =>
					readFileSync(path.replace("-480.webp", "-960.webp")),
			}),
		IMAGE_ERROR_14,
	);
	assert.throws(
		() => webpDimensions(Buffer.from('<svg viewBox="0 0 960 720"></svg>')),
		IMAGE_ERROR_15,
	);
	const bytes = readFileSync(resolve(publicRoot, recipe.image.src.slice(1)));
	assert.throws(
		() => webpDimensions(bytes.subarray(0, bytes.length - 10)),
		IMAGE_ERROR_16,
	);
});

it("every canonical recipe satisfies the image contract", () => {
	const cache = new Map();
	const failures = [];
	for (const recipe of recipes) {
		try {
			validateRecipeImage(recipe, { cache });
		} catch (error) {
			failures.push(`${recipe.id}: ${error.message.split("\n")[0]}`);
		}
	}
	assert.equal(
		failures.length,
		0,
		`${failures.length} recipe image contract failures:\n${failures.join("\n")}`,
	);
});
