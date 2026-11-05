import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "vitest";
import { parse } from "yaml";

it("daily monitoring resolves a strict live release before immutable checkout and validates ancestry before execution", async () => {
	const workflow = parse(
		await readFile(
			new URL("../../.github/workflows/production-smoke.yml", import.meta.url),
			"utf8",
		),
	);
	assert.deepEqual(workflow.on.schedule, [{ cron: "47 10 * * *" }]);
	assert.ok(workflow.jobs.smoke.if.includes("github.event_name == 'schedule'"));
	const steps = workflow.jobs.smoke.steps;
	const resolve = steps.findIndex((step) => step.id === "scheduled-release");
	const checkout = steps.findIndex((step) =>
		step.uses?.startsWith("actions/checkout@"),
	);
	const ancestry = steps.findIndex(
		(step) => step.name === "Verify the release belongs to main",
	);
	const install = steps.findIndex((step) => step.run === "npm ci");
	assert.ok(
		resolve >= 0 &&
			resolve < checkout &&
			checkout < ancestry &&
			ancestry < install,
	);
	assert.equal(steps[resolve].if, "github.event_name == 'schedule'");
	assert.ok(steps[resolve].run.includes("https://www.jsolly.com/release.json"));
	assert.ok(steps[resolve].run.includes("--max-filesize 1024"));
	assert.ok(steps[resolve].run.includes('[[ "$status" == 200 ]]'));
	assert.ok(steps[resolve].run.includes('keys == ["sha"]'));
	assert.ok(steps[resolve].run.includes('test("^[0-9a-f]{40}$")'));
	assert.ok(!steps[resolve].run.includes("--location"));
	assert.ok(
		steps[checkout].with.ref.includes("steps.scheduled-release.outputs.sha"),
	);
	assert.equal(steps[checkout].with["persist-credentials"], false);
	assert.ok(
		steps[ancestry].run.includes(
			'git merge-base --is-ancestor "$PRODUCTION_SMOKE_RELEASE_SHA" origin/main',
		),
	);
	assert.ok(
		steps.some((step) => step.run === "npm run smoke:scenario-contract"),
	);
	assert.ok(steps.some((step) => step.run === "npm run smoke:production"));
});
