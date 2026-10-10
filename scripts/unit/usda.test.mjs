import assert from "node:assert/strict";
import it from "node:test";
import { loadUsdaKey, lookup } from "../recipes/usda.mjs";

const CREDENTIAL_ERROR = /Cannot read the USDA SecureString/u;
const USAGE_ERROR = /Usage:/u;
const KEY = "fixture-only-usda-key-not-a-real-key";
const ARN =
	"arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key";
const IDENTITY = {
	Account: "730335616323",
	Arn: "arn:aws:sts::730335616323:assumed-role/agent-readonly/fixture",
};
const PARAMETER = { ARN, Type: "SecureString", Value: KEY };
const FOOD = {
	fdcId: 168462,
	description: "Spinach, raw",
	dataType: "SR Legacy",
	foodNutrients: [
		{ nutrient: { id: 1003, name: "Protein", unitName: "g" }, amount: 2.86 },
	],
};

it("USDA credentials require the exact agent identity and encrypted parameter", async () => {
	assert.equal(
		await loadUsdaKey({
			identity: () => IDENTITY,
			parameter: () => ({ Parameter: PARAMETER }),
		}),
		KEY,
	);
	await Promise.all(
		[
			{ ...IDENTITY, Account: "111111111111" },
			{
				...IDENTITY,
				Arn: "arn:aws:sts::730335616323:assumed-role/AdministratorAccess/fixture",
			},
		].map(async (identity) => {
			let reads = 0;
			await assert.rejects(
				loadUsdaKey({
					identity: () => identity,
					parameter: () => {
						reads++;
						return { Parameter: PARAMETER };
					},
				}),
				CREDENTIAL_ERROR,
			);
			assert.equal(reads, 0);
		}),
	);
	await Promise.all(
		[
			{ ...PARAMETER, Type: "String" },
			{ ...PARAMETER, ARN: `${ARN}/child` },
			{ ...PARAMETER, Value: "" },
		].map((parameter) =>
			assert.rejects(
				loadUsdaKey({
					identity: () => IDENTITY,
					parameter: () => ({ Parameter: parameter }),
				}),
				CREDENTIAL_ERROR,
			),
		),
	);
	await assert.rejects(
		loadUsdaKey({
			identity: () => IDENTITY,
			parameter: () => {
				throw new Error(KEY);
			},
		}),
		(error) => !error.message.includes(KEY) && !error.cause,
	);
});

it("USDA lookups validate input before credentials and send the key only in a fixed-origin header", async () => {
	await Promise.all(
		[
			[],
			["food", "../secret"],
			["food", "168462", "extra"],
			["search", " "],
		].map((args) =>
			assert.rejects(
				lookup(args, {
					readKey: () => {
						throw new Error("credentials touched");
					},
				}),
				USAGE_ERROR,
			),
		),
	);
	const calls = [];
	const fetchImpl = (url, init) => {
		calls.push({ url: String(url), init });
		return {
			ok: true,
			json: async () =>
				init.method === "POST" ? { totalHits: 1, foods: [FOOD] } : FOOD,
		};
	};
	const result = await lookup(["food", "168462"], {
		readKey: async () => KEY,
		fetchImpl,
	});
	assert.equal(result.foodNutrients[0].amount, 2.86);
	assert.equal(result.foodNutrients[0].nutrient.unitName, "g");
	assert.equal(
		result.sourceUrl,
		"https://fdc.nal.usda.gov/food-details/168462/nutrients",
	);
	const search = await lookup(["search", "raw", "spinach"], {
		readKey: async () => KEY,
		fetchImpl,
	});
	assert.equal(search.foods[0].fdcId, 168462);
	assert.equal(search.foods[0].foodNutrients, undefined);
	assert.deepEqual(JSON.parse(calls[1].init.body), {
		query: "raw spinach",
		pageSize: 25,
	});
	for (const { url, init } of calls) {
		assert.ok(url.startsWith("https://api.nal.usda.gov/fdc/v1/"));
		assert.ok(!url.includes(KEY));
		assert.equal(init.headers["X-Api-Key"], KEY);
		assert.equal(init.redirect, "error");
		assert.ok(init.signal instanceof AbortSignal);
	}
});

it("USDA failures and malformed or credential-bearing responses never expose the key", async () => {
	await Promise.all(
		[
			() => {
				throw new Error(`network failure ${KEY}`);
			},
			async () => ({
				ok: false,
				status: 403,
				json: () => {
					throw new Error(KEY);
				},
			}),
			async () => ({
				ok: true,
				json: () => {
					throw new Error(KEY);
				},
			}),
			async () => ({
				ok: true,
				json: async () => ({ ...FOOD, description: KEY }),
			}),
			async () => ({
				ok: true,
				json: async () => ({ ...FOOD, foodNutrients: null }),
			}),
		].map((fetchImpl) =>
			assert.rejects(
				lookup(["food", "168462"], { readKey: async () => KEY, fetchImpl }),
				(error) =>
					error.message.startsWith("USDA lookup failed.") &&
					!error.message.includes(KEY) &&
					!error.cause,
			),
		),
	);
});
