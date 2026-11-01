// biome-ignore-all lint/suspicious/noMisplacedAssertion lint/nursery/noConditionalExpect: Node assertions validate external CI evidence at runtime, not test expectations.
// Distinct hosted phases; npm run gate never selects these partial entrypoints.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	aggregate,
	identity,
	relativeReport,
	restoreBundle,
	verifyPreparation,
	writeBundle,
} from "./ci-evidence.mjs";
import { assertUnchanged, snapshot } from "./gate-snapshot.mjs";
import { runChains, runPreparation } from "./run-gate.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const vitest = join(ROOT, "node_modules/vitest/vitest.mjs");
const config = join(ROOT, "config/testing/vitest.config.mjs");
const ledger = () =>
	JSON.parse(
		fs.readFileSync(join(ROOT, "config/testing/test-counts.json"), "utf8"),
	).built;
const run = (args, configPath = config) =>
	spawnSync(process.execPath, [vitest, ...args, "--config", configPath], {
		cwd: ROOT,
		env: { ...process.env, TEST_SUITE: "built" },
		stdio: "inherit",
	});

export function validationMode(needs, env) {
	assert.equal(
		needs.prepare.result,
		"success",
		"Preparation failed or was cancelled",
	);
	if (needs.prepare.outputs.run_full === "false") {
		assert.ok(
			env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main",
			"Unproven PR reuse",
		);
		assert.equal(
			needs.built.result,
			"success",
			"Built jobs failed to verify preparation in protected reuse",
		);
		return "reuse";
	}
	assert.equal(
		needs.prepare.outputs.run_full,
		"true",
		"Preparation emitted no full-validation identity",
	);
	assert.equal(
		needs.built.result,
		"success",
		"Built shard failed, skipped or was cancelled",
	);
	return "full";
}

async function main(mode, argument) {
	const id = identity(ROOT);
	const directory =
		process.env.CI_BUILD_DIR ?? join(process.env.RUNNER_TEMP, "ci-build");
	assert.ok(directory, "CI_BUILD_DIR required");
	if (mode === "record-preparation") {
		assert.ok(
			["true", "false"].includes(argument),
			"Missing preparation decision",
		);
		const result = {
			identity: id,
			mode: argument === "true" ? "full" : "reuse",
		};
		verifyPreparation(result, id);
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(
			join(directory, "preparation.json"),
			JSON.stringify(result),
		);
	} else if (mode === "select-preparation") {
		const result = JSON.parse(
			fs.readFileSync(join(directory, "preparation.json"), "utf8"),
		);
		const selected = verifyPreparation(result, id);
		fs.appendFileSync(
			process.env.GITHUB_OUTPUT,
			`run_full=${selected === "full"}\n`,
		);
	} else if (mode === "prepare") {
		const source = await snapshot(ROOT);
		await runPreparation(ROOT);
		fs.mkdirSync(directory, { recursive: true });
		const discovery = join(directory, "discovery.json");
		const child = run(["list", "--filesOnly", `--json=${discovery}`]);
		assert.equal(child.status, 0, "Built file discovery failed");
		const files = JSON.parse(fs.readFileSync(discovery, "utf8"))
			.map(
				({ file }) =>
					relativeReport(ROOT, { testResults: [{ name: file }] }).testResults[0]
						.name,
			)
			.sort();
		writeBundle(ROOT, directory, {
			identity: id,
			files,
			expectedTests: ledger(),
		});
		await assertUnchanged(ROOT, source);
		console.log("Preparation passed; built coverage is still required.");
	} else if (mode === "shard") {
		assert.ok(["1", "2"].includes(argument), "Expected shard 1 or 2");
		const manifest = restoreBundle(ROOT, directory, id);
		assert.equal(
			manifest.expectedTests,
			ledger(),
			"Build count differs from source",
		);
		const logs =
			process.env.CI_REPORT_DIR ??
			join(process.env.RUNNER_TEMP, `ci-report-${argument}`);
		assert.ok(logs, "CI_REPORT_DIR required");
		fs.mkdirSync(logs, { recursive: true });
		const source = await snapshot(ROOT);
		const controller = new AbortController();
		const cancel = () => controller.abort();
		process.on("SIGINT", cancel);
		process.on("SIGTERM", cancel);
		try {
			await runChains(
				[
					{
						name: `built-${argument}`,
						cwd: ROOT,
						commands: [
							[
								`built shard ${argument}/2`,
								process.execPath,
								fileURLToPath(import.meta.url),
								"shard-run",
								argument,
							],
						],
					},
				],
				logs,
				{ signal: controller.signal },
			);
			await assertUnchanged(ROOT, source);
		} finally {
			process.off("SIGINT", cancel);
			process.off("SIGTERM", cancel);
		}
	} else if (mode === "shard-run") {
		assert.ok(["1", "2"].includes(argument), "Expected shard 1 or 2");
		const logs =
			process.env.CI_REPORT_DIR ??
			join(process.env.RUNNER_TEMP, `ci-report-${argument}`);
		const reportPath = join(logs, "vitest.json");
		const child = run(
			[
				"run",
				`--shard=${argument}/2`,
				"--reporter=default",
				"--reporter=json",
				`--outputFile.json=${reportPath}`,
				...(process.env.TEST_FILE_TIMINGS === "1"
					? ["--reporter", join(ROOT, "tests/test-file-timings.mjs")]
					: []),
			],
			join(ROOT, "config/testing/ci-built.config.mjs"),
		);
		const result = JSON.parse(fs.readFileSync(reportPath, "utf8"));
		fs.writeFileSync(
			join(logs, "report.json"),
			JSON.stringify({
				identity: id,
				shard: Number(argument),
				exitCode: child.status ?? 1,
				result: relativeReport(ROOT, result),
			}),
		);
		assert.equal(child.status, 0, "Built shard process failed");
	} else if (mode === "aggregate") {
		const needs = JSON.parse(process.env.CI_NEEDS);
		const selected = validationMode(needs, process.env);
		assert.equal(
			needs.prepare.outputs.tree,
			id.tree,
			"Preparation tree differs from aggregate source",
		);
		if (selected === "full") {
			const manifest = JSON.parse(
				fs.readFileSync(join(directory, "manifest.json"), "utf8"),
			);
			const reportsRoot =
				process.env.CI_REPORTS_DIR ??
				join(process.env.RUNNER_TEMP, "ci-reports");
			const names = [1, 2].map((shard) => `ci-built-${shard}-${id.attempt}`);
			assert.deepEqual(
				fs.readdirSync(reportsRoot).sort(),
				names,
				"Missing or extra shard artifacts",
			);
			const reports = names.map((name) =>
				JSON.parse(
					fs.readFileSync(join(reportsRoot, name, "report.json"), "utf8"),
				),
			);
			console.log(
				"Complete built coverage:",
				aggregate(manifest, reports, id, ledger()),
			);
		} else
			console.log(
				"Reusing the protected identical-tree PR proof; full checks were not rerun.",
			);
		fs.writeFileSync(
			join(process.env.RUNNER_TEMP, "ci-tree-ci.txt"),
			`${id.tree}\n`,
		);
	} else throw new Error("Expected prepare, shard or aggregate");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await main(process.argv[2], process.argv[3]);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
