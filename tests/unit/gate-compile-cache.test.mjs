import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { it } from "vitest";
import { runChains } from "../../gate/run-gate.mjs";

it("persistent compilation rereads changed source and corrupt entries while private checks keep their own cache", async () => {
	const dir = await fs.mkdtemp(join(tmpdir(), "gate-compile-cache-"));
	const logs = join(dir, "logs");
	const shared = join(dir, "shared");
	const isolated = join(dir, "private");
	const stamp = new Date("2020-01-01T00:00:00Z");
	const program = `import { getCompileCacheDir } from 'node:module';\nimport { value } from './value.mjs';\nconsole.log(JSON.stringify({ value, cache: getCompileCacheDir() }));\n`;
	const replace = `import fs from 'node:fs/promises';
 const before = await fs.stat('value.mjs');
 await fs.writeFile('value.mjs', 'export const value = "BB";\\n');
 await fs.utimes('value.mjs', before.atime, before.mtime);
 if ((await fs.stat('value.mjs')).mtimeMs !== before.mtimeMs) throw Error('mtime changed');`;
	const corrupt = `import fs from 'node:fs/promises'; import { join } from 'node:path';
 const cache = process.env.NODE_COMPILE_CACHE;
 const files = (await fs.readdir(cache, { recursive:true, withFileTypes:true })).filter(entry => entry.isFile());
 await Promise.all(files.map(entry => fs.writeFile(join(entry.parentPath, entry.name), 'corrupt cache')));
 console.log(JSON.stringify({ corrupted: files.length }));`;
	const env = {
		...process.env,
		NODE_COMPILE_CACHE: shared,
		NODE_DISABLE_COMPILE_CACHE: undefined,
	};
	try {
		await fs.mkdir(logs);
		await fs.mkdir(isolated);
		await fs.writeFile(join(dir, "entry.mjs"), program);
		await fs.writeFile(join(dir, "value.mjs"), 'export const value = "AA";\n');
		await fs.utimes(join(dir, "value.mjs"), stamp, stamp);
		await fs.writeFile(join(isolated, "entry.mjs"), program);
		await fs.writeFile(
			join(isolated, "value.mjs"),
			'export const value = "private";\n',
		);
		await runChains(
			[
				{
					name: "build",
					cwd: dir,
					commands: [
						["first compilation", process.execPath, "entry.mjs"],
						[
							"change equal-sized source without changing mtime",
							process.execPath,
							"--input-type=module",
							"-e",
							replace,
						],
						["changed source", process.execPath, "entry.mjs"],
						[
							"corrupt compiled entries",
							process.execPath,
							"--input-type=module",
							"-e",
							corrupt,
						],
						["corrupt cache recovery", process.execPath, "entry.mjs"],
					],
				},
				{
					name: "unit",
					cwd: isolated,
					privateTree: true,
					commands: [["private cache", process.execPath, "entry.mjs"]],
				},
			],
			logs,
			{ env },
		);
		const results = (await fs.readFile(join(logs, "build.log"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.deepEqual(
			results
				.filter((result) => "value" in result)
				.map((result) => result.value),
			["AA", "BB", "BB"],
		);
		assert.ok(results[0].cache.startsWith(shared + sep));
		assert.ok(
			results[2].corrupted > 0,
			"the actual child runtime persisted compiled code before corruption",
		);
		const privateResult = JSON.parse(
			await fs.readFile(join(logs, "unit.log"), "utf8"),
		);
		assert.equal(privateResult.value, "private");
		assert.ok(
			privateResult.cache.startsWith(join(logs, "node-cache", "unit") + sep),
		);
		assert.ok(!privateResult.cache.startsWith(shared + sep));
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
