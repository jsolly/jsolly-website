import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import it from "node:test";
import { parseSummary, runCounted } from "../run-tests.mjs";

const BELOW_LEDGER = /2 of 3 tests passed, below the 3 recorded/u;
const ABOVE_LEDGER = /Set "fixture" to 2 in this commit/u;
const NO_SUMMARY = /no test summary/u;
const EXITED = /node --test exited with 1/u;

const FIXTURE = `import it from "node:test";
it("first", () => {});
it("second", () => {});
it("skipped", { skip: true }, () => {});
`;

it("a pass count that differs from the ledger fails the suite", () => {
	const dir = mkdtempSync(join(tmpdir(), "run-tests-fixture-"));
	try {
		writeFileSync(join(dir, "fixture.test.mjs"), FIXTURE);
		writeFileSync(
			join(dir, "failing.test.mjs"),
			'import it from "node:test";\nit("fails", () => { throw new Error("x"); });\n',
		);
		writeFileSync(join(dir, "plain.mjs"), "");
		const suite = {
			label: "fixture",
			flags: ["--test"],
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
			flags: [],
			patterns: ["plain.mjs"],
			expected: 0,
		});
		assert.equal(unsummarized.ok, false, "no summary fails closed");
		assert.match(unsummarized.message, NO_SUMMARY);

		assert.deepEqual(
			parseSummary(
				"# Subtest: s\n    # tests 9\n# out of band\n# tests 4\n# pass 3\n# fail 1\n# tests 2\n# pass 2\n# fail 0\n",
			),
			{ tests: 2, pass: 2, fail: 0 },
			"only unindented summary lines count, and the last one wins",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
