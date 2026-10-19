import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { parseSummary, runCounted } from "../run-tests.mjs";

const BELOW_LEDGER = /2 of 3 tests passed, below the 3 recorded/u;
const ABOVE_LEDGER = /Set "fixture" to 2 in this commit/u;
const NO_SUMMARY = /Vitest exited with 1/u;
const EXITED = /Vitest exited with 1/u;

const FIXTURE = `import { it } from "vitest";
it("first", () => {});
it("second", () => {});
it.skip("skipped", () => {});
`;

it("a pass count that differs from the ledger fails the suite", () => {
	const dir = mkdtempSync(join(tmpdir(), "run-tests-fixture-"));
	try {
		symlinkSync(
			new URL("../../node_modules", import.meta.url),
			join(dir, "node_modules"),
			"dir",
		);
		writeFileSync(join(dir, "fixture.test.mjs"), FIXTURE);
		writeFileSync(
			join(dir, "failing.test.mjs"),
			'import { it } from "vitest";\nit("fails", () => { throw new Error("x"); });\n',
		);
		writeFileSync(join(dir, "plain.mjs"), "");
		const suite = {
			label: "fixture",
			patterns: ["fixture.test.mjs"],
			cwd: dir,
			stdio: "ignore",
		};

		const matching = runCounted({ ...suite, expected: 2 });
		assert.ok(matching.ok, matching.message);

		const below = runCounted({ ...suite, expected: 3 });
		assert.equal(
			below.ok,
			false,
			"a skipped test does not count toward the ledger",
		);
		assert.match(below.message, BELOW_LEDGER);

		const above = runCounted({ ...suite, expected: 1 });
		assert.equal(above.ok, false, "unrecorded new tests fail the suite");
		assert.match(above.message, ABOVE_LEDGER);

		const failing = runCounted({
			...suite,
			patterns: ["failing.test.mjs"],
			expected: 0,
		});
		assert.equal(failing.ok, false);
		assert.match(failing.message, EXITED);

		const unsummarized = runCounted({
			...suite,
			patterns: ["plain.mjs"],
			expected: 0,
		});
		assert.equal(unsummarized.ok, false, "no summary fails closed");
		assert.match(unsummarized.message, NO_SUMMARY);

		assert.deepEqual(
			parseSummary(
				JSON.stringify({
					numTotalTests: 3,
					numPassedTests: 2,
					numFailedTests: 1,
				}),
			),
			{ tests: 3, pass: 2, fail: 1 },
		);
		assert.deepEqual(parseSummary("{}"), {}, "a missing summary fails closed");
		assert.throws(() => parseSummary("not JSON"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
