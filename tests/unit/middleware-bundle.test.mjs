import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOCAL_IMPORT =
	/^\s*(?:import|export)\b[^;]*?\bfrom\s+"(?<specifier>\.[^"]+)"(?<rest>[^;\n]*)/gmu;
const IMPORT_ATTRIBUTES = /\bwith\s*\{/u;
const EMITTED_JS = /\.js$/u;
const SCRIPT = /\.(?:ts|mjs|js)$/u;

// The module, or its .ts source when the specifier names the emitted .js.
function localModule(from, specifier) {
	const path = resolve(dirname(from), specifier);
	return [path, path.replace(EMITTED_JS, ".ts")].find(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
	);
}

// Vercel bundles middleware.ts at deploy time with a parser that rejects
// import attributes (`with { type: "json" }`): the build fails with
// `Expected ";" but found "with"`. The gate never bundles the middleware, so
// this keeps every local module the middleware loads free of them.
it("the middleware and its local imports use no import attributes", () => {
	const pending = [resolve(ROOT, "middleware.ts")];
	const seen = new Set();
	while (pending.length > 0) {
		const file = pending.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		if (!SCRIPT.test(file)) continue;
		for (const match of readFileSync(file, "utf8").matchAll(LOCAL_IMPORT)) {
			const { specifier = "", rest = "" } = match.groups ?? {};
			const statement = match[0];
			assert.ok(
				!IMPORT_ATTRIBUTES.test(rest),
				`${relative(ROOT, file)}: ${statement.trim()}`,
			);
			const target = localModule(file, specifier);
			if (target) pending.push(target);
		}
	}
	assert.ok(
		seen.has(resolve(ROOT, "vercel.json")),
		"middleware reads vercel.json",
	);
});
