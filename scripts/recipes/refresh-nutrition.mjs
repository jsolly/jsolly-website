// Maintenance only: refresh reviewed FDC matches, never search/rematch ingredients.

import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { reconcileMacros } from "./reconcile-nutrition.mjs";
import { loadUsdaKey, lookup } from "./usda.mjs";
import { observation } from "./usda-observation.mjs";

const ROOT = new URL("../../", import.meta.url);
const NUTRITION = new URL("src/components/recipes/nutrition-data.json", ROOT);
const RECIPES = new URL("src/components/recipes/recipes.json", ROOT);
const MACROS = {
	kcal: [1008, "kcal"],
	protein_g: [1003, "g"],
	carbs_g: [1005, "g"],
	fiber_g: [1079, "g"],
};

const FDC_SOURCE =
	/^https:\/\/fdc\.nal\.usda\.gov\/food-details\/(?<id>\d+)\/nutrients$/u;
export function foodId(row) {
	return Number(row.source?.match(FDC_SOURCE)?.groups.id) || null;
}

export function refreshModels(nutrition, recipes, foods, retrievedAt) {
	const result = structuredClone(nutrition);
	const recipeResult = structuredClone(recipes);
	let refreshedRows = 0;
	const skippedRows = [];
	const collections = [
		...Object.entries(result.recipes),
		...Object.entries(result.familyOptions ?? {}).map(([id, rows]) => [
			`${id}/family`,
			rows,
		]),
	];
	for (const [recipeId, rows] of collections) {
		for (const row of rows) {
			const id = foodId(row);
			// Fortified nutritional yeast combines a brand label and USDA minerals.
			// Non-FDC sources include composite seasonings and brand-specific products.
			if (!id || row.food === "yeast") {
				skippedRows.push({
					recipeId,
					food: row.food ?? row.ingredientId,
					reason: id
						? "hybrid brand/USDA profile"
						: "brand or composite profile",
				});
				continue;
			}
			const food = foods.get(id);
			if (
				!food ||
				food.fdcId !== id ||
				!["SR Legacy", "Survey (FNDDS)"].includes(food.dataType)
			)
				throw new Error(`Missing reviewed SR Legacy/FNDDS record ${id}`);
			// Refresh the existing observation set only. Deliberate omissions (including
			// the sausage proxy's outlier iron) must not be silently reintroduced.
			for (const key of Object.keys(row.nutrients)) {
				const nutrient = result.nutrients.find((entry) => entry.key === key);
				if (!nutrient) throw new Error(`Unknown nutrient ${key}`);
				const amount = observation(food, nutrient.usdaId, nutrient.unit);
				if (amount === undefined && row.nutrients[key] !== null)
					delete row.nutrients[key];
				else if (amount !== undefined) row.nutrients[key] = amount;
			}
			for (const [key, [nutrientId, unit]] of Object.entries(MACROS)) {
				if (
					!row.macros ||
					row.assumedMacroFields?.includes(key) ||
					(row.macroSource && row.macroSource !== row.source)
				)
					continue;
				const amount = observation(food, nutrientId, unit);
				if (amount === undefined && row.macros[key] !== null)
					delete row.macros[key];
				else if (amount !== undefined) row.macros[key] = amount;
			}
			refreshedRows++;
		}
	}
	for (const recipe of recipeResult.recipes) {
		if (recipe.measurementNutritionBaseline) {
			for (const option of recipe.familyOptions ?? []) {
				const row = result.familyOptions?.[recipe.id]?.find(
					(item) => item.ingredientId === option.id,
				);
				if (!row)
					throw new Error(`Missing family model: ${recipe.id}/${option.id}`);
				for (const key of Object.keys(MACROS))
					option.nutrition[key] = Number.isFinite(row.macros?.[key])
						? (row.macros[key] * row.grams) / 100
						: null;
				option.nutrition.net_carbs_g =
					Number.isFinite(option.nutrition.carbs_g) &&
					Number.isFinite(option.nutrition.fiber_g)
						? Math.max(0, option.nutrition.carbs_g - option.nutrition.fiber_g)
						: null;
			}
			reconcileMacros(
				recipe,
				result.recipes[recipe.id],
				recipeResult.baseServings,
			);
			continue;
		}
		const fields =
			recipe.sourceRecipe?.nutritionEstimate?.estimatedMacroFields ?? [];
		const rows = result.recipes[recipe.id];
		for (const key of fields) {
			if (key === "net_carbs_g") continue;
			if (!rows.every((row) => Number.isFinite(row.macros?.[key])))
				throw new Error(`Missing ${key} observation for ${recipe.id}`);
			recipe.nutrition[key] =
				rows.reduce(
					(sum, row) => sum + (row.macros[key] * row.grams) / 100,
					0,
				) / recipeResult.baseServings;
		}
		if (fields.length)
			recipe.nutrition.net_carbs_g = Math.max(
				0,
				recipe.nutrition.carbs_g - recipe.nutrition.fiber_g,
			);
	}
	const receipt = {
		retrievedAt,
		endpoint: "https://api.nal.usda.gov/fdc/v1/food/{fdcId}",
		matchedFoodIds: [...foods.keys()].sort((a, b) => a - b),
		refreshedRows,
		skippedRows,
		policy:
			"Existing reviewed SR Legacy/FNDDS matches and observation sets only; no rematching, new zeros, cooking-retention factors or changes to edible weights. Brand/composite profiles, fortified yeast, assumed macro fields, omega-3 observations and supported publisher macros retained.",
	};
	result.apiRefresh = receipt;
	return { nutrition: result, recipes: recipeResult, receipt };
}

// Keep reviewed numeric spellings (0.0 versus 0) while adding API provenance.
function serializePreservingNumbers(value, originalText) {
	const parsed = JSON.parse(originalText);
	if (JSON.stringify(parsed) === JSON.stringify(value)) return originalText;
	if (
		!parsed.apiRefresh &&
		JSON.stringify({ ...parsed, apiRefresh: undefined }) ===
			JSON.stringify({ ...value, apiRefresh: undefined })
	)
		return `${originalText.trimEnd().slice(0, -1).trimEnd()},\n\t"apiRefresh": ${JSON.stringify(value.apiRefresh, null, "\t").replaceAll("\n", "\n\t")}\n}\n`;
	const original = JSON.parse(originalText, (_key, item, context) =>
		typeof item === "number" ? { number: item, raw: context.source } : item,
	);
	function preserve(item, old) {
		if (typeof item === "number" && old?.number === item)
			return JSON.rawJSON(old.raw);
		if (Array.isArray(item))
			return item.map((entry, index) => preserve(entry, old?.[index]));
		if (item && typeof item === "object")
			return Object.fromEntries(
				Object.entries(item).map(([key, entry]) => [
					key,
					preserve(entry, old?.[key]),
				]),
			);
		return item;
	}
	return `${JSON.stringify(preserve(value, original), null, "\t")}\n`;
}

async function main(args) {
	if (![2, 4].includes(args.length) || args[0] !== "--cache")
		throw new Error(
			"Usage: node scripts/recipes/refresh-nutrition.mjs --cache /absolute/public-response-cache",
		);
	if (!args[1].startsWith("/"))
		throw new Error("Use an absolute cache path outside the repository.");
	const cache = realpathSync(
		await mkdir(args[1], { recursive: true }).then(() => args[1]),
	);
	if (cache.startsWith(fileURLToPath(ROOT)))
		throw new Error("Public response cache must be outside the repository.");
	const delayMs =
		args.length === 4 && args[2] === "--delay-ms" ? Number(args[3]) : 4000;
	if (
		!Number.isInteger(delayMs) ||
		delayMs < 0 ||
		delayMs > 60000 ||
		(args.length === 4 && args[2] !== "--delay-ms")
	)
		throw new Error("Delay must be an integer from 0 to 60000 milliseconds.");
	const nutrition = JSON.parse(await readFile(NUTRITION, "utf8"));
	const recipes = JSON.parse(await readFile(RECIPES, "utf8"));
	const ids = [
		...new Set(
			[
				...Object.values(nutrition.recipes),
				...Object.values(nutrition.familyOptions ?? {}),
			]
				.flat()
				.filter((row) => row.food !== "yeast")
				.map(foodId)
				.filter(Boolean),
		),
	].sort((a, b) => a - b);
	const foods = new Map();
	let key;
	const readKey = async () => key;
	for (const id of ids) {
		const path = `${cache}/${id}.json`;
		let record;
		try {
			// biome-ignore lint/performance/noAwaitInLoops: sequential cache reads preserve quota-limited processing.
			record = JSON.parse(await readFile(path, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (!record) {
			key ??= await loadUsdaKey();
			const food = await lookup(["food", String(id)], {
				readKey,
			});
			record = { retrievedAt: new Date().toISOString(), food };
			await writeFile(path, `${JSON.stringify(record)}\n`);
			// USDA standard quota is 1,000 requests/hour; one every four seconds.
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		foods.set(id, record.food);
		console.log(`Reviewed FDC ${id} (${foods.size}/${ids.length})`);
	}
	const retrievedAt = (
		await Promise.all(
			ids.map(
				async (id) =>
					JSON.parse(await readFile(`${cache}/${id}.json`, "utf8")).retrievedAt,
			),
		)
	).sort()[0];
	const refreshed = refreshModels(nutrition, recipes, foods, retrievedAt);
	await writeFile(
		NUTRITION,
		serializePreservingNumbers(
			refreshed.nutrition,
			await readFile(NUTRITION, "utf8"),
		),
	);
	const recipeText = await readFile(RECIPES, "utf8");
	if (
		JSON.stringify(JSON.parse(recipeText)) !== JSON.stringify(refreshed.recipes)
	)
		await writeFile(
			RECIPES,
			serializePreservingNumbers(refreshed.recipes, recipeText),
		);
	console.log(
		JSON.stringify({
			foods: foods.size,
			refreshedRows: refreshed.receipt.refreshedRows,
			retainedBrandOrCompositeRows: refreshed.receipt.skippedRows.length,
		}),
	);
}
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
