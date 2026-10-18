import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import it from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
// Astro and the Svelte integration can resolve different Vite versions. Use the
// actual Astro graph; a passing test against another installed Vite proves less.
const astroRequire = createRequire(require.resolve("astro/package.json"));
const viteRequire = createRequire(astroRequire.resolve("vite/package.json"));
const { transformWithOxc } = await import(
	pathToFileURL(viteRequire.resolve("vite"))
);
const { resolveTsconfig } = await import(
	pathToFileURL(viteRequire.resolve("rolldown/experimental"))
);
const { TsconfigCache } = await import(
	pathToFileURL(viteRequire.resolve("rolldown/utils"))
);

// This is a real compiler-consumer regression: the old inherited membership
// erased the import below. No mock, forced compiler options or cache clearing.
it("native TypeScript scope applies compiler policy to intended inputs", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "website-tsconfig-")));
	const source =
		'import { unused } from "/src/dependency.ts"; export const marker: number = 17;';
	function put(name, body) {
		const path = join(root, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, body);
		return path;
	}
	try {
		for (const name of ["tsconfig.json", "config/typescript/tsconfig.json"]) {
			put(name, readFileSync(join(ROOT, name)));
		}
		put("package.json", '{"type":"module"}');
		symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"), "dir");
		put(
			"src/dependency.ts",
			'export const unused = 17; globalThis[Symbol.for("config-proof")] = true;',
		);
		put(
			"src/nested/tsconfig.json",
			JSON.stringify({
				compilerOptions: { verbatimModuleSyntax: false },
				include: ["owned.ts"],
			}),
		);
		const positive = [
			"src/probe.ts",
			"src/pages/probe.ts",
			"middleware.ts",
			"config/app/astro.ts",
			"src/nested/fallback.ts",
		];
		const negative = [
			"loose.ts",
			"config/typescript/probe.ts",
			"config/app/unlisted.ts",
			"dist/probe.ts",
			"src/probe.test.ts",
			"node_modules/offscope/probe.ts",
		];
		for (const name of [
			...positive,
			...negative.filter((entry) => !entry.startsWith("node_modules/")),
			"src/nested/owned.ts",
		])
			put(name, source);
		await Promise.all(
			positive.map(async (name) => {
				const path = join(root, name);
				assert.equal(
					resolveTsconfig(path, new TsconfigCache())?.tsconfig.compilerOptions
						.verbatimModuleSyntax,
					true,
					name,
				);
				assert(
					(await transformWithOxc(source, path)).code.includes("dependency.ts"),
					name,
				);
			}),
		);
		for (const name of negative)
			assert.equal(
				resolveTsconfig(join(root, name), new TsconfigCache()),
				null,
				name,
			);
		assert.equal(
			resolveTsconfig(join(root, "src/nested/owned.ts"), new TsconfigCache())
				?.tsconfig.compilerOptions.verbatimModuleSyntax,
			false,
		);
		assert(
			!(
				await transformWithOxc(source, join(root, "src/nested/owned.ts"))
			).code.includes("dependency.ts"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
