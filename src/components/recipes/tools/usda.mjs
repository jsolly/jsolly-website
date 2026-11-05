// Human-operated USDA maintenance. A protected key arrives only on stdin.
// Builds and browser requests never import this module.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FINAL_NEWLINE = /\r?\n$/u;
const API_KEY = /^[A-Za-z0-9_-]{16,256}$/u;
const FOOD_ID = /^[1-9][0-9]{0,9}$/u;
const API = "https://api.nal.usda.gov/fdc/v1/";
const INPUT_ERROR =
	"USDA maintenance requires one protected API key on stdin. John supplies it directly from the named human AWS procedure in docs/recipes.md. No AWS credential provider or agent fallback is available.";

export async function loadUsdaKey(input = process.stdin) {
	if (input.isTTY) throw new Error(INPUT_ERROR);
	let value = "";
	let bytes = 0;
	try {
		for await (const chunk of input) {
			bytes += Buffer.byteLength(chunk);
			// A 256-byte key plus an optional final CRLF is the entire input.
			if (bytes > 258) throw new Error(INPUT_ERROR);
			value += chunk.toString();
		}
	} catch {
		// biome-ignore lint/style/useErrorCause: input failures may contain the key.
		throw new Error(INPUT_ERROR);
	}
	const key = value.replace(FINAL_NEWLINE, "");
	if (!API_KEY.test(key)) throw new Error(INPUT_ERROR);
	return key;
}

function requestFor(args) {
	if (args[0] === "food" && args.length === 2 && FOOD_ID.test(args[1])) {
		return { path: `food/${args[1]}`, init: { method: "GET" }, kind: "food" };
	}
	if (args[0] === "search" && args.length > 1) {
		const query = args.slice(1).join(" ").trim();
		if (query.length > 0 && query.length <= 200) {
			return {
				path: "foods/search",
				init: { method: "POST", body: JSON.stringify({ query, pageSize: 25 }) },
				kind: "search",
			};
		}
	}
	throw new Error(
		'Usage: npm run recipes:usda -- search "raw spinach" | food 168462',
	);
}

function summary(food) {
	if (
		!Number.isSafeInteger(food?.fdcId) ||
		food.fdcId <= 0 ||
		typeof food.description !== "string"
	)
		throw new Error("Unexpected USDA response");
	return {
		fdcId: food.fdcId,
		description: food.description,
		dataType: food.dataType,
		brandOwner: food.brandOwner,
		brandName: food.brandName,
		gtinUpc: food.gtinUpc,
		sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
	};
}

function publicResult(data, kind) {
	if (kind === "search") {
		if (!Array.isArray(data?.foods))
			throw new Error("Unexpected USDA response");
		return { totalHits: data.totalHits, foods: data.foods.map(summary) };
	}
	if (!Array.isArray(data?.foodNutrients))
		throw new Error("Unexpected USDA response");
	return {
		...summary(data),
		publicationDate: data.publicationDate,
		servingSize: data.servingSize,
		servingSizeUnit: data.servingSizeUnit,
		// Keep USDA units and missing values; never infer a recipe portion here.
		foodNutrients: data.foodNutrients.map(
			({ nutrient, amount, dataPoints, derivationCode }) => ({
				nutrient,
				amount,
				dataPoints,
				derivationCode,
			}),
		),
		foodPortions: data.foodPortions,
	};
}

export async function lookup(
	args,
	{ readKey = loadUsdaKey, fetchImpl = fetch } = {},
) {
	const request = requestFor(args); // Validate before touching credentials.
	const key = await readKey();
	try {
		const response = await fetchImpl(new URL(request.path, API), {
			...request.init,
			headers: { "X-Api-Key": key, "Content-Type": "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error(`USDA returned HTTP ${response.status}.`);
		}
		const result = publicResult(await response.json(), request.kind);
		if (JSON.stringify(result).includes(key))
			throw new Error("Credential found in response");
		return result;
	} catch {
		// Do not echo URLs, headers, response bodies, or the fetch error/cause.
		// biome-ignore lint/style/useErrorCause: secret-bearing causes must not escape.
		throw new Error(
			"USDA lookup failed. Check API access, quota, network connectivity, and the stored key; no response body was logged.",
		);
	}
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		console.log(JSON.stringify(await lookup(process.argv.slice(2)), null, 2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
