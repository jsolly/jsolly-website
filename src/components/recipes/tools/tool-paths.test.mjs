import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { it } from "vitest";

const TOOLS = new URL("./", import.meta.url);
const REPO_ROOT = new URL("../../../../", TOOLS);
// Matches one-line and Biome's wrapped `new URL(\n"...",\nbase,\n)` forms.
const LITERAL_URL =
	/new URL\(\s*"(?<literal>[^"$]+)",\s*(?<base>import\.meta\.url|ROOT)\s*,?\s*\)/gu;
const ROOT_DEFINITION =
	/const ROOT = new URL\(\s*"(?<literal>[^"$]+)",\s*import\.meta\.url\s*,?\s*\)/u;

it("every literal path a recipe tool resolves from its own location or ROOT exists", () => {
	const missing = [];
	let checked = 0;
	for (const name of readdirSync(TOOLS).filter((file) =>
		file.endsWith(".mjs"),
	)) {
		const self = new URL(name, TOOLS);
		const source = readFileSync(self, "utf8");
		// A tool's own ROOT must be the repo root, or its ROOT-based paths silently move.
		const rootLiteral = source.match(ROOT_DEFINITION)?.groups.literal;
		const root = rootLiteral ? new URL(rootLiteral, self) : undefined;
		if (root && root.href !== REPO_ROOT.href) {
			missing.push(`${name}: ROOT ${rootLiteral} is not the repo root`);
		}
		for (const { groups } of source.matchAll(LITERAL_URL)) {
			checked += 1;
			const from = groups.base === "ROOT" ? root : self;
			if (!(from && existsSync(new URL(groups.literal, from)))) {
				missing.push(`${name}: ${groups.literal} (${groups.base})`);
			}
		}
	}
	// A depth change that misses an anchor shows up here, not on the next manual run.
	assert.ok(checked > 12, `found only ${checked} literal paths`);
	assert.deepEqual(missing, []);
});
