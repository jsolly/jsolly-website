import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname } from "node:path";
import { setImmediate } from "node:timers/promises";
import { it, vi } from "vitest";
import { createTempCopy } from "../built/temp-copy.mjs";

for (const operation of ["cp", "symlink"]) {
	it(`a failed temporary ${operation} waits for in-flight work before removing its directory`, async () => {
		const mkdir = fs.mkdir.bind(fs);
		const mkdtemp = fs.mkdtemp.bind(fs);
		const remove = fs.rm.bind(fs);
		let dir;
		let calls = 0;
		let settled = false;
		const events = [];
		const started = Promise.withResolvers();
		const finish = Promise.withResolvers();
		const completed = Promise.withResolvers();
		const failure = new Error(`injected ${operation} failure`);

		// Keep the real helper's file discovery and cleanup, but only the held
		// operation writes. This isolates failure ownership from the full build.
		vi.spyOn(fs, "mkdtemp").mockImplementation(async (...args) => {
			dir = await mkdtemp(...args);
			return dir;
		});
		vi.spyOn(fs, "mkdir").mockImplementation(() => Promise.resolve());
		vi.spyOn(fs, "cp").mockImplementation(() => Promise.resolve());
		vi.spyOn(fs, "rm").mockImplementation((...args) => {
			events.push("cleanup");
			return remove(...args);
		});
		vi.spyOn(fs, operation).mockImplementation(async (_source, target) => {
			calls += 1;
			if (calls === 1) throw failure;
			if (calls !== 2) return;
			started.resolve();
			try {
				await finish.promise;
				await mkdir(dirname(target), { recursive: true });
				await fs.writeFile(target, "completed sibling operation");
				events.push("completed");
			} finally {
				completed.resolve();
			}
		});
		const result = createTempCopy(`cleanup-${operation}`).then(
			() => {
				settled = true;
				throw new Error("temporary copy unexpectedly succeeded");
			},
			(error) => {
				settled = true;
				return error;
			},
		);
		try {
			await started.promise;
			// Drain the current promise continuations, without advancing the
			// held operation or relying on a wall-clock observation window.
			await setImmediate();
			assert.deepEqual(events, [], "cleanup cannot start with work in flight");
			assert.equal(settled, false, "the caller still owns the pending work");
			finish.resolve();
			assert.equal(await result, failure, "the original error propagates");
			assert.deepEqual(events, ["completed", "cleanup"]);
			await assert.rejects(fs.stat(dir), { code: "ENOENT" });
		} finally {
			finish.resolve();
			await result;
			await completed.promise;
			if (dir) await remove(dir, { recursive: true, force: true });
		}
	});
}
