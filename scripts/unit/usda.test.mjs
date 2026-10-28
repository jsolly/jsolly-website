import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { it } from "vitest";
import { loadUsdaKey, lookup } from "../recipes/usda.mjs";

const KEY = "fixture-only-usda-key-not-a-real-key";
const USAGE_ERROR = /Usage:/u;
const INPUT_ERROR = /requires one protected API key on stdin/u;
const FOOD = {
	fdcId: 168462,
	description: "Spinach, raw",
	dataType: "SR Legacy",
	foodNutrients: [
		{ nutrient: { id: 1003, name: "Protein", unitName: "g" }, amount: 2.86 },
	],
};

it.each([KEY, `${KEY}\n`, `${KEY}\r\n`])(
	"USDA maintenance reads exactly one key from a bounded pipe: %j",
	async (text) => {
		assert.equal(
			await loadUsdaKey(Readable.from([text.slice(0, 9), text.slice(9)])),
			KEY,
		);
	},
);

it.each(["", "short", `${KEY}\n${KEY}`, ` ${KEY}`, `${KEY} `, "a".repeat(257)])(
	"USDA maintenance rejects empty, malformed or oversized input: %j",
	async (text) => {
		await assert.rejects(loadUsdaKey(Readable.from([text])), (error) => {
			assert.match(error.message, INPUT_ERROR);
			assert.ok(!error.message.includes(KEY));
			assert.equal(error.cause, undefined);
			return true;
		});
	},
);

it("USDA maintenance refuses a terminal before reading input", async () => {
	await assert.rejects(
		loadUsdaKey({
			isTTY: true,
			[Symbol.asyncIterator]() {
				throw new Error("must not read");
			},
		}),
		INPUT_ERROR,
	);
});

it("USDA maintenance sanitizes a pipe failure after partial key bytes", async () => {
	const input = Readable.from(
		(function* () {
			yield KEY;
			throw new Error(`input failed ${KEY}`, { cause: new Error(KEY) });
		})(),
	);
	await assert.rejects(loadUsdaKey(input), (error) => {
		assert.match(error.message, INPUT_ERROR);
		assert.ok(!error.message.includes(KEY));
		assert.equal(error.cause, undefined);
		return true;
	});
});

it("USDA maintenance stops consuming an oversized stream", async () => {
	let reads = 0;
	const input = (function* () {
		reads++;
		yield "x".repeat(259);
		reads++;
		throw new Error("must not continue");
	})();
	await assert.rejects(loadUsdaKey(input), INPUT_ERROR);
	assert.equal(reads, 1);
});

it.each(["static environment", "credential process"])(
	"USDA CLI refuses %s fallback without stdin",
	async (source) => {
		const root = await mkdtemp(join(tmpdir(), "usda-no-provider-"));
		try {
			const marker = join(root, "provider-ran");
			const network = join(root, "network-ran");
			const provider = join(root, "provider.mjs");
			await writeFile(
				provider,
				`import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "called"); process.exit(1);`,
			);
			const config = join(root, "config");
			const credentials = join(root, "credentials");
			await writeFile(
				config,
				`[profile fixture]\ncredential_process = ${process.execPath} ${provider}\n`,
			);
			await writeFile(credentials, "");
			const preload = join(root, "no-network.mjs");
			await writeFile(
				preload,
				`
import http from "node:http";
import https from "node:https";
import {syncBuiltinESMExports} from "node:module";
import {writeFileSync} from "node:fs";
const refuse = () => {writeFileSync(${JSON.stringify(network)}, "called"); throw Error("Network forbidden in fixture");};
http.request = refuse;
https.request = refuse;
globalThis.fetch = refuse;
syncBuiltinESMExports();
`,
			);
			const env = {
				HOME: root,
				AWS_CONFIG_FILE: config,
				AWS_SHARED_CREDENTIALS_FILE: credentials,
				AWS_PROFILE: "fixture",
				AWS_EC2_METADATA_DISABLED: "true",
				USDA_API_KEY: KEY,
				...(source === "static environment"
					? {
							AWS_ACCESS_KEY_ID: "fixture-access-key",
							AWS_SECRET_ACCESS_KEY: KEY,
						}
					: {}),
			};
			const result = spawnSync(
				process.execPath,
				["--import", preload, "scripts/recipes/usda.mjs", "food", "168462"],
				{ env, input: "", encoding: "utf8", timeout: 10000 },
			);
			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, INPUT_ERROR);
			assert.equal(result.stdout, "");
			assert.ok(!result.stderr.includes(KEY));
			await assert.rejects(readFile(marker), { code: "ENOENT" });
			await assert.rejects(readFile(network), { code: "ENOENT" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

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
