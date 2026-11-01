// Vitest calls queued from the worker before importing the test file, and end
// after its afterAll hooks. Measure that interval, not summed testcase times.
// Worker startup and environment preparation precede this interval.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export default class TestFileTimings {
	starts = new Map();

	onTestModuleQueued(module) {
		this.starts.set(module.moduleId, performance.now());
	}

	onTestModuleEnd(module) {
		const start = this.starts.get(module.moduleId);
		if (start === undefined) {
			throw new Error(`Missing timing start for ${module.moduleId}`);
		}
		const diagnostic = module.diagnostic();
		const row = {
			suite: process.env.TEST_SUITE,
			file: module.relativeModuleId,
			wall_ms: Math.round(performance.now() - start),
			collect_ms: Math.round(diagnostic.collectDuration),
			tests_hooks_ms: Math.round(diagnostic.duration),
			state: module.state(),
		};
		const json = JSON.stringify(row);
		console.log(`TIMING ${json}`);
		const directory = process.env.TEST_FILE_TIMINGS_DIR;
		if (directory) {
			mkdirSync(directory, { recursive: true });
			// Each runner owns its file, including builds nested inside built tests.
			appendFileSync(
				join(directory, `${row.suite}-${process.pid}.jsonl`),
				`${json}\n`,
			);
		}
		this.starts.delete(module.moduleId);
	}
}
