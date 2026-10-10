// Maintenance-only USDA lookups. Credentials stay in memory; builds never import this file.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const REGION = "us-east-1";
const PARAMETER = "/shared/nutrition/usda-api-key";
const ARN =
	"arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key";
const AGENT_ROLE = /^arn:aws:sts::730335616323:assumed-role\/agent-readonly\//u;
const API_KEY = /^[A-Za-z0-9_-]{16,256}$/u;
const FOOD_ID = /^[1-9][0-9]{0,9}$/u;
const API = "https://api.nal.usda.gov/fdc/v1/";

async function readIdentity() {
	const client = new STSClient({
		region: REGION,
		maxAttempts: 2,
		requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
		endpoint: `https://sts.${REGION}.amazonaws.com`,
	});
	try {
		return await client.send(new GetCallerIdentityCommand({}));
	} finally {
		client.destroy();
	}
}

async function readParameter() {
	const client = new SSMClient({
		region: REGION,
		maxAttempts: 2,
		requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
		endpoint: `https://ssm.${REGION}.amazonaws.com`,
	});
	try {
		return await client.send(
			new GetParameterCommand({ Name: PARAMETER, WithDecryption: true }),
		);
	} finally {
		client.destroy();
	}
}

export async function loadUsdaKey({
	identity = readIdentity,
	parameter = readParameter,
} = {}) {
	try {
		const caller = await identity();
		if (caller.Account !== "730335616323" || !AGENT_ROLE.test(caller.Arn ?? ""))
			throw new Error("Unexpected AWS identity");
		const { Parameter: value } = await parameter();
		if (
			value?.ARN !== ARN ||
			value.Type !== "SecureString" ||
			typeof value.Value !== "string" ||
			!API_KEY.test(value.Value)
		)
			throw new Error("Unexpected parameter");
		return value.Value;
	} catch {
		// SDK errors can contain sensitive payloads. Never forward them.
		// biome-ignore lint/style/useErrorCause: secret-bearing causes must not escape.
		throw new Error(
			"Cannot read the USDA SecureString. Use the signed-in agent-readonly identity; confirm its deployed permission and the parameter in account 730335616323, us-east-1.",
		);
	}
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
