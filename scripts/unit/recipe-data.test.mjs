import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};
import { drift, generate } from "../recipes/sync-assistant-data.mjs";

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));
const MEDIA_PATH = /\/recipes\/media\/[^\s",]+/gu;

it("every /recipes/media/ file the recipe images reference exists under public/recipes/media", () => {
	const referenced = new Set(
		data.recipes.flatMap((recipe) =>
			Object.values(recipe.image).flatMap((value) =>
				typeof value === "string"
					? [...value.matchAll(MEDIA_PATH)].map(([path]) => path)
					: [],
			),
		),
	);
	assert.ok(referenced.size > 0, "recipe images reference /recipes/media/");
	const missing = [...referenced].filter(
		(path) => !existsSync(join(PUBLIC, path)),
	);
	assert.deepEqual(missing, [], "referenced recipe media are missing");
});

it("recipes:check reports an edited and a missing assistant download as drift", async () => {
	const dir = await mkdtemp(join(tmpdir(), "recipe-data-"));
	try {
		const files = [...generate()];
		await Promise.all(
			files.map(([name, content]) => writeFile(join(dir, name), content)),
		);
		assert.deepEqual(await drift(dir), [], "fresh output has no drift");
		const [[jsonName], [markdownName, markdown]] = files;
		await writeFile(join(dir, markdownName), `${markdown}edited\n`);
		assert.deepEqual(await drift(dir), [markdownName]);
		await rm(join(dir, jsonName));
		assert.deepEqual(await drift(dir), [jsonName, markdownName]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
