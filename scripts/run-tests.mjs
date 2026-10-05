// Count-checked node:test runner. Every test suite (`npm test`, `npm run
// test:built`, the CSP check inside `build` and the smoke-scenario contract) runs through this wrapper, which fails when the number of passing tests
// differs from the count recorded in scripts/test-counts.json. A test that
// silently stops running (a narrowed glob, a deleted file, a stray skip) then
// fails the gate instead of leaving it green, and a commit that adds tests must
// record them, so a later commit cannot drop them unnoticed. Lower a count only
// in a commit that names each dropped test.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER = "scripts/test-counts.json";
// Top-level TAP summary lines only; nested subtest output is indented.
const TAP_SUMMARY = /^# (?<key>tests|pass|fail) (?<count>\d+)$/gmu;

const SUITES = {
	unit: {
		flags: [
			"--import",
			"./scripts/register-ts-from-js.mjs",
			"--experimental-strip-types",
			"--test",
		],
		patterns: ["src/**/*.test.ts", "scripts/unit/*.test.mjs"],
	},
	// Post-build tests against dist/ that run outside `build` (browser tests need
	// Playwright, which the Vercel build does not have); see `csp` below.
	built: {
		flags: ["--test", "--test-concurrency=1"],
		patterns: ["scripts/built/*.test.mjs"],
	},
	// Runs inside `build` (and so on Vercel), right after process-html.
	csp: {
		flags: ["--test"],
		patterns: ["scripts/built-csp.test.mjs"],
	},
	smoke: {
		flags: ["--test"],
		patterns: ["scripts/production-smoke-scenario.test.mjs"],
	},
};

// The last summary wins: a test's own stdout reaches TAP as `# ...` diagnostics
// before the runner prints its final summary.
export function parseSummary(tap) {
	const summary = {};
	for (const match of tap.matchAll(TAP_SUMMARY)) {
		summary[match.groups.key] = Number(match.groups.count);
	}
	return summary;
}

// A wrapper started from inside a node:test file must not hand the runner's
// child marker to its own `node --test`, or that run reports to the outer runner.
function childEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
	);
}

export function runCounted({
	label,
	flags,
	patterns,
	expected,
	cwd = ROOT,
	stdio = "inherit",
}) {
	const reportDir = mkdtempSync(join(tmpdir(), "run-tests-"));
	const tapPath = join(reportDir, "report.tap");
	try {
		const child = spawnSync(
			process.execPath,
			[
				...flags,
				"--test-reporter=spec",
				"--test-reporter-destination=stdout",
				"--test-reporter=tap",
				`--test-reporter-destination=${tapPath}`,
				...patterns,
			],
			{ cwd, env: childEnv(), stdio },
		);
		if (child.error) {
			return {
				ok: false,
				message: `✗ ${label}: could not start node --test: ${child.error.message}`,
			};
		}
		if (child.status !== 0) {
			return {
				ok: false,
				message: `✗ ${label}: node --test exited with ${child.status ?? child.signal}.`,
			};
		}
		let tap = "";
		try {
			tap = readFileSync(tapPath, "utf8");
		} catch {
			// A missing report fails below as a missing summary.
		}
		const { tests, pass, fail } = parseSummary(tap);
		if (tests === undefined || pass === undefined || fail === undefined) {
			return {
				ok: false,
				message: `✗ ${label}: node --test printed no test summary, so the count cannot be checked.`,
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
	const suite = Object.hasOwn(SUITES, suiteName)
		? SUITES[suiteName]
		: undefined;
	if (!suite) {
		console.error(
			`usage: node scripts/run-tests.mjs <${Object.keys(SUITES).join("|")}>`,
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
	const result = runCounted({ label: suiteName, ...suite, expected });
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
