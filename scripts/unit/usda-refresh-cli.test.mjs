import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

const KEY = "fixture-only-usda-key-not-a-real-key";
const IDS = [123, 456, 789];
const record = (id) => ({
	retrievedAt: "2026-10-13T00:00:00Z",
	food: {
		fdcId: id,
		description: `Food ${id}`,
		dataType: "SR Legacy",
		foodNutrients: [],
	},
});

it.each([true, false])(
	"USDA refresh CLI preserves lazy single stdin acquisition, complete cache=%s",
	async (complete) => {
		const scratch = await mkdtemp(join(tmpdir(), "usda-refresh-cli-"));
		try {
			const root = join(scratch, "repo");
			const scripts = join(root, "scripts/recipes");
			const data = join(root, "src/components/recipes");
			const cache = join(scratch, "public-cache");
			await Promise.all(
				[scripts, data, cache].map((path) => mkdir(path, { recursive: true })),
			);
			// Run the real CLI and modules, with synthetic data and a fake HTTP boundary.
			await Promise.all(
				[
					"refresh-nutrition.mjs",
					"usda.mjs",
					"usda-observation.mjs",
					"reconcile-nutrition.mjs",
				].map((name) =>
					copyFile(
						new URL(`../recipes/${name}`, import.meta.url),
						join(scripts, name),
					),
				),
			);
			const rows = [...IDS, 456].map((id) => ({
				food: `ingredient-${id}`,
				grams: 100,
				nutrients: {},
				source: `https://fdc.nal.usda.gov/food-details/${id}/nutrients`,
			}));
			await writeFile(
				join(data, "nutrition-data.json"),
				JSON.stringify({ nutrients: [], recipes: { one: rows } }),
			);
			const recipes = JSON.stringify({ baseServings: 4, recipes: [] });
			await writeFile(join(data, "recipes.json"), recipes);
			await Promise.all(
				(complete ? IDS : [123]).map((id) =>
					writeFile(join(cache, `${id}.json`), JSON.stringify(record(id))),
				),
			);
			const log = join(scratch, "boundary.jsonl");
			await writeFile(log, "");
			const preload = join(scratch, "boundary.mjs");
			await writeFile(
				preload,
				`
import assert from "node:assert/strict";
import {appendFileSync} from "node:fs";
const log = value => appendFileSync(${JSON.stringify(log)}, JSON.stringify(value)+"\\n");
if (${complete}) {
  Object.defineProperty(process.stdin, "isTTY", {get() {throw Error("Complete cache must not inspect stdin");}});
} else {
  const original = process.stdin[Symbol.asyncIterator].bind(process.stdin);
  process.stdin[Symbol.asyncIterator] = function() { log({stdin: true}); return original(); };
}
globalThis.fetch = async (url, init) => {
  assert.equal(${complete}, false, "Complete cache must not fetch");
  assert.equal(init.headers["X-Api-Key"], ${JSON.stringify(KEY)});
  assert.equal(init.redirect, "error");
  assert.match(String(url), /^https:\\/\\/api\\.nal\\.usda\\.gov\\/fdc\\/v1\\/food\\/(456|789)$/u);
  const id = Number(url.pathname.split("/").at(-1));
  log({fetched: id});
  return {ok: true, json: async () => ({fdcId: id, description: "Fixture food", dataType: "SR Legacy", foodNutrients: []})};
};
`,
			);
			const result = spawnSync(
				process.execPath,
				[
					"--import",
					preload,
					join(scripts, "refresh-nutrition.mjs"),
					"--cache",
					cache,
					"--delay-ms",
					"0",
				],
				{
					input: complete ? "" : `${KEY}\n`,
					encoding: "utf8",
					timeout: 10000,
				},
			);
			assert.equal(result.status, 0, result.stderr);
			assert.ok(!`${result.stdout}${result.stderr}`.includes(KEY));
			assert.deepEqual(
				(await readFile(log, "utf8"))
					.split("\n")
					.filter(Boolean)
					.map(JSON.parse),
				complete ? [] : [{ stdin: true }, { fetched: 456 }, { fetched: 789 }],
			);
			const refreshed = JSON.parse(
				await readFile(join(data, "nutrition-data.json"), "utf8"),
			);
			assert.deepEqual(refreshed.apiRefresh.matchedFoodIds, IDS);
			assert.equal(refreshed.apiRefresh.refreshedRows, 4);
			assert.equal(await readFile(join(data, "recipes.json"), "utf8"), recipes);
			const cached = await Promise.all(
				IDS.map((id) => readFile(join(cache, `${id}.json`), "utf8")),
			);
			assert.ok(cached.every((text) => !text.includes(KEY)));
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	},
);
