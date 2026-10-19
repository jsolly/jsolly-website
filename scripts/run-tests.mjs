// Count-checked Vitest entrypoint. The passing-test ledger preserves discovery
// across unit, built, CSP and smoke suites, including skipped-test detection.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER = "config/testing/test-counts.json";
const SUITES = new Set([
	"unit",
	"built",
	"csp",
	"smoke",
	"production",
	"workflow",
]);

export function parseSummary(report) {
	const parsed = JSON.parse(report);
	if (
		![parsed.numTotalTests, parsed.numPassedTests, parsed.numFailedTests].every(
			Number.isInteger,
		)
	)
		return {};
	return {
		tests: parsed.numTotalTests,
		pass: parsed.numPassedTests,
		fail: parsed.numFailedTests,
	};
}

export function runCounted({
	label,
	patterns = [],
	expected,
	cwd = ROOT,
	stdio = "inherit",
}) {
	const reportDir = mkdtempSync(join(tmpdir(), "run-tests-"));
	const reportPath = join(reportDir, "report.json");
	try {
		const child = spawnSync(
			process.execPath,
			[
				join(ROOT, "node_modules/vitest/vitest.mjs"),
				"run",
				"--config",
				join(ROOT, "config/testing/vitest.config.mjs"),
				"--root",
				cwd,
				"--reporter=default",
				"--reporter=json",
				`--outputFile.json=${reportPath}`,
				...patterns,
			],
			{ cwd, env: { ...process.env, TEST_SUITE: label }, stdio },
		);
		if (child.error) {
			return {
				ok: false,
				message: `✗ ${label}: could not start Vitest: ${child.error.message}`,
			};
		}
		if (child.status !== 0) {
			return {
				ok: false,
				message: `✗ ${label}: Vitest exited with ${child.status ?? child.signal}.`,
			};
		}
		let report = "";
		try {
			report = readFileSync(reportPath, "utf8");
		} catch {
			// A missing report fails below as a missing summary.
		}
		let summary = {};
		try {
			summary = parseSummary(report);
		} catch {
			/* malformed reports fail closed below */
		}
		const { tests, pass, fail } = summary;
		if (tests === undefined || pass === undefined || fail === undefined) {
			return {
				ok: false,
				message: `✗ ${label}: Vitest printed no test summary, so the count cannot be checked.`,
			};
		}
		if (fail > 0) {
			return {
				ok: false,
				message: `✗ ${label}: ${fail} failing test(s).`,
			};
		}
		if (pass < expected) {
			return {
				ok: false,
				message: `✗ ${label}: ${pass} of ${tests} tests passed, below the ${expected} recorded in ${LEDGER}. Restore the missing tests, or lower the count in a commit that names each dropped test.`,
			};
		}
		if (pass > expected) {
			return {
				ok: false,
				message: `✗ ${label}: ${pass} tests passed but ${LEDGER} records ${expected}. Set "${label}" to ${pass} in this commit.`,
			};
		}
		return {
			ok: true,
			message: `✓ ${label}: ${pass} tests passed, matching ${LEDGER}.`,
		};
	} finally {
		rmSync(reportDir, { recursive: true, force: true });
	}
}

function main(suiteName) {
	const suite = SUITES.has(suiteName);
	if (!suite) {
		console.error(
			`usage: node scripts/run-tests.mjs <${[...SUITES].join("|")}>`,
		);
		return 2;
	}
	const ledger = JSON.parse(readFileSync(join(ROOT, LEDGER), "utf8"));
	const expected = ledger[suiteName];
	if (!Number.isInteger(expected) || expected < 0) {
		console.error(
			`✗ ${LEDGER} has no non-negative integer count for "${suiteName}".`,
		);
		return 1;
	}
	const result = runCounted({ label: suiteName, expected });
	if (result.ok) {
		console.log(result.message);
		return 0;
	}
	console.error(result.message);
	return 1;
}

// `import.meta.main` needs Node 24.2; engines allows any 24.x.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exitCode = main(process.argv[2]);
}
