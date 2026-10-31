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
	assert.equal(a11y.jobs.audit.if, "github.ref == 'refs/heads/main'");
	// Reporting runs after failures, never after cancellation, and installs no
	// dependencies alongside the token.
	assert.equal(
		a11y.jobs.report.if,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		"${{ !cancelled() && github.ref == 'refs/heads/main' }}",
	);
	assert.ok(!a11y.jobs.report.steps.some((step) => step.run?.includes("npm")));
});

const workflow = (name) =>
	parse(readFileSync(join(".github/workflows", name), "utf8"));

it("PR CI audits the sample and the Accessibility workflow audits every page", () => {
	const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
	assert.equal(scripts["check:a11y"], "node scripts/check-accessibility.mjs");
	assert.equal(
		scripts["check:a11y:sample"],
		"node scripts/check-accessibility.mjs --sample",
	);
	const runs = (steps) =>
		steps.filter((step) => step.run?.includes("check:a11y"));
	const { audit, report } = workflow("a11y.yml").jobs;
	assert.deepEqual(
		runs(audit.steps).map((step) => step.run),
		["npm run check:a11y"],
	);
	assert.deepEqual(
		runs(workflow("ci.yml").jobs.built.steps).map(({ if: when, run }) => ({
			if: when,
			run,
		})),
		[
			{
				if: "steps.preparation.outputs.run_full == 'true' && matrix.shard == 1",
				run: "npm run check:a11y:sample",
			},
		],
	);
	// The report finds the audit's artifact by ID, also when only it is re-run.
	const upload = audit.steps.find((step) => step.id === "results");
	assert.ok(upload.uses.startsWith("actions/upload-artifact@"));
	assert.deepEqual(audit.outputs, {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		"artifact-id": "${{ steps.results.outputs.artifact-id }}",
	});
	const download = report.steps.find((step) =>
		step.uses?.startsWith("actions/download-artifact@"),
	);
	assert.equal(download.if, "needs.audit.outputs.artifact-id != ''");
	assert.deepEqual(download.with, {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		"artifact-ids": "${{ needs.audit.outputs.artifact-id }}",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		path: "${{ runner.temp }}/a11y",
	});
});

// A job that restores ~/.npm without running npm ci saves an empty cache under
// the shared key, and every later job restores it as a hit.
it("every npm cache keys on .nvmrc and package-lock.json and follows npm ci", () => {
	const cached = readdirSync(".github/workflows")
		.filter((name) => name.endsWith(".yml"))
		.flatMap((name) =>
			Object.entries(workflow(name).jobs).flatMap(([id, job]) =>
				(job.steps ?? [])
					.filter(
						(step) =>
							step.uses?.startsWith("actions/setup-node@") &&
							step.with?.cache !== undefined,
					)
					.map((step) => ({
						job: `${name}:${id}`,
						paths: String(step.with["cache-dependency-path"] ?? "")
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean),
						cache: step.with.cache,
						npmCi: job.steps.some((other) => other.run === "npm ci"),
					})),
			),
		);
	assert.deepEqual(cached.map(({ job }) => job).sort(), [
		"a11y.yml:audit",
		"ci.yml:built",
		"ci.yml:prepare",
		"legacy-redirects.yml:verify",
		"production-smoke.yml:smoke",
		"ui-preview-checks.yml:ci-preview",
	]);
	for (const { job, paths, npmCi } of cached) {
		assert.deepEqual(paths, [".nvmrc", "package-lock.json"], job);
		assert.ok(npmCi, job);
	}
	// Preparation's npm ci is conditional, so its cache must be too.
	const prepare = workflow("ci.yml").jobs.prepare.steps;
	assert.equal(
		cached.find(({ job }) => job === "ci.yml:prepare").cache,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		"${{ steps.verified-tree.outputs.run_full != 'false' && 'npm' || '' }}",
	);
	assert.equal(
		prepare.find((step) => step.run === "npm ci").if,
		"steps.verified-tree.outputs.run_full != 'false'",
	);
});
