import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { it } from "vitest";

const TOOLS = new URL("./", import.meta.url);
const ROOT = new URL("../../../../", TOOLS);
const LITERAL_URL =
	/new URL\(\s*"(?<literal>[^"$]+)",\s*(?<base>import\.meta\.url|ROOT)\s*\)/gu;

it("every literal path a recipe tool resolves from its own location or ROOT exists", () => {
	const missing = [];
	let checked = 0;
	for (const name of readdirSync(TOOLS).filter((file) =>
		file.endsWith(".mjs"),
	)) {
		const source = readFileSync(new URL(name, TOOLS), "utf8");
		for (const { groups } of source.matchAll(LITERAL_URL)) {
			checked += 1;
			const from = groups.base === "ROOT" ? ROOT : new URL(name, TOOLS);
			if (!existsSync(new URL(groups.literal, from))) {
				missing.push(`${name}: ${groups.literal} (${groups.base})`);
			}
		}
	}
	// A depth change that misses an anchor shows up here, not on the next manual run.
	assert.ok(checked > 10, `found only ${checked} literal paths`);
	assert.deepEqual(missing, []);
});
