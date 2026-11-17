import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { withOfflineNodeGuard } from "../network/node/guard.ts";

it("Node transports and child processes enforce the loopback boundary", () => {
	const child = spawnSync(
		process.execPath,
		[
			fileURLToPath(
				new URL("../network/node/controls/controller.ts", import.meta.url),
			),
		],
		{
			env: withOfflineNodeGuard({}),
			encoding: "utf8",
			timeout: 180_000,
		},
	);
	assert.ifError(child.error);
	assert.equal(child.signal, null, child.stderr);
	assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
});

it("native controls run from a copied checkout with spaces and non-ASCII paths", () => {
	const directory = mkdtempSync(join(tmpdir(), "network space café-"));
	try {
		cpSync(new URL("../network", import.meta.url), join(directory, "network"), {
			recursive: true,
		});
		const child = spawnSync(
			process.execPath,
			[join(directory, "network/node/controls/controller.ts")],
			{
				env: withOfflineNodeGuard({}),
				encoding: "utf8",
				timeout: 180_000,
			},
		);
		assert.ifError(child.error);
		assert.equal(child.signal, null, child.stderr);
		assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

// Each child gets a fresh guard so one expected denial cannot taint another case.
it("offline accounting includes file teardown and returned beforeAll cleanup", () => {
	const directory = mkdtempSync(join(tmpdir(), "network-lifecycle-"));
	try {
		mkdirSync(join(directory, "tests/unit"), { recursive: true });
		symlinkSync(
			new URL("../../node_modules", import.meta.url),
			join(directory, "node_modules"),
			"dir",
		);
		symlinkSync(
			new URL("../network", import.meta.url),
			join(directory, "tests/network"),
			"dir",
		);
		cpSync(
			new URL("../fixtures/network-lifecycle.ts", import.meta.url),
			join(directory, "tests/unit/lifecycle.test.ts"),
		);
		for (const scenario of ["clean", "cleanup", "afterAll"]) {
			const receipt = join(directory, `${scenario}.json`);
			const reportPath = join(directory, `${scenario}-report.json`);
			const child = spawnSync(
				process.execPath,
				[
					fileURLToPath(
						new URL("../../node_modules/vitest/vitest.mjs", import.meta.url),
					),
					"run",
					"--config",
					fileURLToPath(
						new URL("../../config/testing/vitest.config.mjs", import.meta.url),
					),
					"--root",
					directory,
					"tests/unit/lifecycle.test.ts",
					"--reporter=default",
					"--reporter=json",
					`--outputFile.json=${reportPath}`,
				],
				{
					cwd: directory,
					env: withOfflineNodeGuard({
						...process.env,
						TEST_SUITE: "unit",
						NETWORK_LIFECYCLE_CASE: scenario,
						NETWORK_LIFECYCLE_RECEIPT: receipt,
					}),
					encoding: "utf8",
					timeout: 30_000,
				},
			);
			assert.ifError(child.error);
			assert.equal(child.signal, null, child.stderr);
			const output = `${child.stdout}\n${child.stderr}`;
			assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), {
				scenario,
				events: ["body", "afterAll", "cleanup"],
				denialCodes: scenario === "clean" ? [] : ["ERR_TEST_NETWORK_ACCESS"],
				accepted: 1,
				lookups: 0,
				listening: false,
			});
			assert.equal(
				child.status,
				scenario === "clean" ? 0 : 1,
				`${scenario}: ${output}`,
			);
			const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
			assert.partialDeepStrictEqual(report, {
				numTotalTestSuites: 1,
				numFailedTestSuites: scenario === "clean" ? 0 : 1,
				numTotalTests: 1,
				numPassedTests: 1,
				numFailedTests: 0,
				success: scenario === "clean",
				testResults: [
					{
						status: scenario === "clean" ? "passed" : "failed",
						message:
							scenario === "clean"
								? ""
								: "Offline tests may connect only to loopback fixture endpoints",
						assertionResults: [{ status: "passed", failureMessages: [] }],
					},
				],
			});
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
