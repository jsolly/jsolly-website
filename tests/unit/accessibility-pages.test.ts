import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

it("the no-install accessibility page inventory uses only Node builtins", (t) => {
	const root = mkdtempSync(join(tmpdir(), "a11y-pages-test-"));
	t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "about"));
	mkdirSync(join(root, "_vercel"));
	writeFileSync(join(root, "about/index.html"), "<h1>About</h1>");
	writeFileSync(join(root, "404.html"), "<h1>Not found</h1>");
	writeFileSync(join(root, "_vercel/index.html"), "Ignored deployment output");
	const moduleUrl = new URL(
		"../../monitoring/accessibility-pages.ts",
		import.meta.url,
	).href;
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
import { isBuiltin, registerHooks } from "node:module";
const [moduleUrl, root] = process.argv.slice(1);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== moduleUrl && !isBuiltin(specifier))
      throw new Error("The no-install page inventory imported " + specifier);
    return nextResolve(specifier, context);
  },
});
const { builtPages } = await import(moduleUrl);
process.stdout.write(JSON.stringify(await builtPages(root)));
`,
			moduleUrl,
			root,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.deepEqual(JSON.parse(result.stdout).sort(), ["/404.html", "/about/"]);
});
