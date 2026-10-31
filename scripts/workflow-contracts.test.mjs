import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { parse } from "yaml";

for (const script of [
	"scripts/vercel-preview-comment-contract.sh",
	"scripts/vercel-preview-workflow-contract.sh",
]) {
	it(`${script} preserves its workflow contract`, () => {
		const result = spawnSync("bash", [script], { encoding: "utf8" });
		assert.ifError(result.error);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	});
}

// A token minted in any main-context run carries the subject shared-infra's
// scheduled-checks role trusts, so only the Accessibility report job may hold
// id-token: write, and only from push, schedule and dispatch runs on main.
it("only the Accessibility report job can mint an OIDC token", () => {
	const dir = ".github/workflows";
	const mints = (permissions) =>
		permissions === "write-all" || permissions?.["id-token"] === "write";
	const holders = readdirSync(dir)
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.flatMap((name) => {
			const workflow = parse(readFileSync(join(dir, name), "utf8"));
			return [
				...(mints(workflow.permissions) ? [`${name}:*`] : []),
				...Object.entries(workflow.jobs)
					.filter(([, job]) => mints(job.permissions))
					.map(([id]) => `${name}:${id}`),
			];
		});
	assert.deepEqual(holders, ["a11y.yml:report"]);
	const a11y = parse(readFileSync(join(dir, "a11y.yml"), "utf8"));
	assert.deepEqual(Object.keys(a11y.on).sort(), [
		"push",
		"schedule",
		"workflow_dispatch",
	]);
	assert.deepEqual(a11y.on.push, { branches: ["main"] });
	assert.deepEqual(a11y.permissions, { contents: "read" });
	assert.deepEqual(a11y.jobs.report.permissions, {
		contents: "read",
		"id-token": "write",
	});
	for (const job of Object.values(a11y.jobs))
		assert.ok(job.if.includes("github.ref == 'refs/heads/main'"));
	// Reporting runs after failures, never after cancellation, and installs no
	// dependencies alongside the token.
	assert.ok(a11y.jobs.report.if.includes("!cancelled()"));
	assert.ok(!a11y.jobs.report.steps.some((step) => step.run?.includes("npm")));
});
