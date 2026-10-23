import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { it } from "vitest";
import { parse } from "yaml";
import {
	aggregate,
	restoreBundle,
	verifyPreparation,
	writeBundle,
} from "../ci-evidence.mjs";
import { validationMode } from "../ci-gate.mjs";

const id = {
	sha: "a".repeat(40),
	tree: "b".repeat(40),
	run: "123",
	attempt: "2",
};
const manifest = {
	identity: id,
	files: ["scripts/built/a.test.mjs", "scripts/built/b.test.mjs"],
	expectedTests: 2,
};
function reports() {
	return [1, 2].map((shard) => ({
		identity: { ...id },
		shard,
		exitCode: 0,
		result: {
			success: true,
			numTotalTests: 1,
			numPassedTests: 1,
			numFailedTests: 0,
			numPendingTests: 0,
			numTodoTests: 0,
			numFailedTestSuites: 0,
			testResults: [
				{
					name: manifest.files[shard - 1],
					status: "passed",
					assertionResults: [{ status: "passed" }],
				},
			],
		},
	}));
}
function fixture(t) {
	const directory = fs.mkdtempSync(join(tmpdir(), "ci-artifacts-"));
	t.onTestFinished(() =>
		fs.rmSync(directory, { recursive: true, force: true }),
	);
	const root = join(directory, "source");
	const out = join(directory, "archive");
	for (const file of [
		"dist/release.json",
		".recipe-browse/page.html",
		"src/generated/route-manifest.js",
	]) {
		fs.mkdirSync(join(root, file, ".."), { recursive: true });
		fs.writeFileSync(join(root, file), file);
	}
	writeBundle(root, out, manifest);
	return { root, out, directory };
}
function changeBundle(out, mutate) {
	const file = join(out, "build.json.gz");
	const bundle = JSON.parse(gunzipSync(fs.readFileSync(file)));
	mutate(bundle);
	const bytes = gzipSync(JSON.stringify(bundle));
	fs.writeFileSync(file, bytes);
	const proof = JSON.parse(fs.readFileSync(join(out, "manifest.json")));
	proof.archiveSha256 = createHash("sha256").update(bytes).digest("hex");
	fs.writeFileSync(join(out, "manifest.json"), JSON.stringify(proof));
}

it("accepts only complete disjoint built files and actual passing assertions", () => {
	assert.deepEqual(aggregate(manifest, reports(), id, 2), {
		files: 2,
		tests: 2,
	});
});
it("rejects missing, duplicated and unexpected shard coverage", () => {
	assert.throws(() => aggregate(manifest, reports().slice(0, 1), id, 2));
	const duplicate = reports();
	duplicate[1].result.testResults[0].name = manifest.files[0];
	assert.throws(() => aggregate(manifest, duplicate, id, 2));
	const extra = reports();
	extra[1].result.testResults[0].name = "scripts/built/extra.test.mjs";
	assert.throws(() => aggregate(manifest, extra, id, 2));
	assert.throws(() =>
		aggregate(
			{
				...manifest,
				files: [...manifest.files, "scripts/built/missing.test.mjs"],
			},
			reports(),
			id,
			2,
		),
	);
});
it("rejects skipped, todo, failed and fabricated test summaries", () => {
	for (const status of ["pending", "todo", "failed"]) {
		const changed = reports();
		changed[0].result.testResults[0].assertionResults[0].status = status;
		assert.throws(() => aggregate(manifest, changed, id, 2));
	}
	const changed = reports();
	changed[0].result.numTotalTests = 2;
	changed[0].result.numPassedTests = 2;
	assert.throws(() => aggregate(manifest, changed, id, 2));
	const failed = reports();
	failed[0].exitCode = 37;
	assert.throws(() => aggregate(manifest, failed, id, 2));
	assert.throws(() => aggregate(manifest, reports(), id, 3));
});
it("rejects stale identity, attempts and duplicate shard reports", () => {
	for (const field of ["sha", "tree", "run", "attempt"]) {
		const changed = reports();
		changed[0].identity[field] = "stale";
		assert.throws(() => aggregate(manifest, changed, id, 2));
	}
	const duplicate = reports();
	duplicate[1].shard = 1;
	assert.throws(() => aggregate(manifest, duplicate, id, 2));
});
it("requires successful jobs and restricts protected reuse to main pushes", () => {
	const needs = {
		prepare: { result: "success", outputs: { run_full: "true" } },
		built: { result: "success" },
	};
	assert.equal(validationMode(needs, {}), "full");
	for (const job of ["prepare", "built"])
		for (const state of ["failure", "cancelled", "skipped"]) {
			const changed = structuredClone(needs);
			changed[job].result = state;
			assert.throws(() => validationMode(changed, {}));
		}
	const reuse = {
		prepare: { result: "success", outputs: { run_full: "false" } },
		built: { result: "success" },
	};
	assert.throws(() =>
		validationMode(reuse, {
			GITHUB_EVENT_NAME: "pull_request",
			GITHUB_REF: "refs/pull/1/merge",
		}),
	);
	assert.equal(
		validationMode(reuse, {
			GITHUB_EVENT_NAME: "push",
			GITHUB_REF: "refs/heads/main",
		}),
		"reuse",
	);
});
it("runs the actual aggregate workflow condition after failures while keeping deferrals separate", () => {
	const workflow = parse(fs.readFileSync(".github/workflows/ci.yml", "utf8"));
	const evaluate = (expression, eventContext, needs) => {
		const code = expression
			.replaceAll(
				"github.event.pull_request.labels.*.name",
				"github.event.pull_request.labels.map(label => label.name)",
			)
			.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/gu, "");
		// biome-ignore lint/nursery/noImpliedEval: Execute the actual repository-owned Actions condition against fixture contexts, rather than testing a copied condition.
		return new Function(
			"github",
			"needs",
			"always",
			"contains",
			`return (${code});`,
		)(
			eventContext,
			needs,
			() => true,
			(array, value) => array.includes(value),
		);
	};
	const github = {
		event_name: "pull_request",
		repository: "owner/repo",
		event: {
			action: "synchronize",
			label: { name: "unrelated" },
			pull_request: {
				draft: false,
				user: { login: "owner", type: "User" },
				head: { repo: { full_name: "owner/repo" } },
				labels: [],
			},
		},
	};
	assert.deepEqual(workflow.jobs.ci.needs, ["prepare", "built"]);
	assert.equal(workflow.jobs.built.needs, undefined);
	assert.equal(evaluate(workflow.jobs.built.if, github, {}), true);
	assert.equal(
		evaluate(workflow.jobs.ci.if, github, {
			prepare: { result: "failure" },
			built: { result: "cancelled" },
		}),
		true,
	);
	assert.equal(evaluate(workflow.jobs.ci.name, github, {}), "ci");
	for (const defer of ["dependabot", "preview", "label"]) {
		const changed = structuredClone(github);
		if (defer === "dependabot")
			changed.event.pull_request.user.login = "dependabot[bot]";
		if (defer === "preview") {
			changed.event.pull_request.draft = true;
			changed.event.pull_request.labels = [{ name: "preview" }];
		}
		if (defer === "label") changed.event.action = "labeled";
		assert.equal(evaluate(workflow.jobs.ci.if, changed, {}), false);
		assert.equal(evaluate(workflow.jobs.ci.name, changed, {}), "ci-deferred");
		assert.equal(evaluate(workflow.jobs.prepare.if, changed, {}), false);
		assert.equal(evaluate(workflow.jobs.built.if, changed, {}), false);
	}
});
it("roundtrips only generated build bytes and replaces stale generated output", (t) => {
	const f = fixture(t);
	fs.writeFileSync(join(f.root, "dist/stale"), "stale");
	fs.writeFileSync(join(f.root, "tracked"), "source");
	restoreBundle(f.root, f.out, id);
	assert.equal(fs.existsSync(join(f.root, "dist/stale")), false);
	assert.equal(fs.readFileSync(join(f.root, "tracked"), "utf8"), "source");
	assert.equal(
		fs.readFileSync(join(f.root, "dist/release.json"), "utf8"),
		"dist/release.json",
	);
});
it("rejects unsafe archive paths before changing any generated or tracked bytes", (t) => {
	for (const path of [
		"../outside",
		"/tmp/outside",
		"dist/../outside",
		"node_modules/executable",
		"src/generated/route-manifest.js/../../source",
	]) {
		const f = fixture(t);
		changeBundle(f.out, (bundle) => {
			bundle.files[0].path = path;
		});
		assert.throws(() => restoreBundle(f.root, f.out, id));
		assert.equal(
			fs.readFileSync(join(f.root, "dist/release.json"), "utf8"),
			"dist/release.json",
		);
	}
});
it("rejects corrupt archives, changed file bytes and symlink destinations", (t) => {
	const corrupt = fixture(t);
	fs.appendFileSync(join(corrupt.out, "build.json.gz"), "bad");
	assert.throws(() => restoreBundle(corrupt.root, corrupt.out, id));
	const changed = fixture(t);
	changeBundle(changed.out, (bundle) => {
		bundle.files[0].bytes = Buffer.from("corrupt").toString("base64");
	});
	assert.throws(() => restoreBundle(changed.root, changed.out, id));
	const linked = fixture(t);
	fs.rmSync(join(linked.root, "dist"), { recursive: true });
	fs.symlinkSync(linked.out, join(linked.root, "dist"));
	assert.throws(() => restoreBundle(linked.root, linked.out, id));
});
it("protected tree preparation requires the required ci proof from the latest successful attempt", (t) => {
	const f = fixture(t);
	const bin = join(f.directory, "bin");
	fs.mkdirSync(bin);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GITHUB_JOB: "prepare",
		GITHUB_REPOSITORY: "owner/repo",
		GITHUB_EVENT_NAME: "push",
		GITHUB_REF: "refs/heads/main",
		GITHUB_RUN_ID: "999",
		RUNNER_TEMP: f.directory,
		GITHUB_OUTPUT: join(f.directory, "output"),
		GITHUB_STEP_SUMMARY: join(f.directory, "summary"),
		GITHUB_EVENT_PATH: join(f.directory, "event.json"),
		PATH: `${bin}:${process.env.PATH}`,
	};
	for (const key of Object.keys(env))
		if (
			key.startsWith("GIT_") &&
			!["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"].includes(key)
		)
			delete env[key];
	const git = (...args) =>
		execFileSync("git", args, { cwd: f.root, env, encoding: "utf8" }).trim();
	git("init", "-q");
	git("add", ".");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-qm",
		"fixture",
	);
	env.GITHUB_SHA = git("rev-parse", "HEAD");
	const tree = git("rev-parse", "HEAD^{tree}");
	fs.writeFileSync(
		env.GITHUB_EVENT_PATH,
		JSON.stringify({
			forced: false,
			created: false,
			deleted: false,
			repository: { default_branch: "main" },
		}),
	);
	const proof = join(f.directory, "proof.json");
	env.PROOF = proof;
	fs.writeFileSync(
		join(bin, "gh"),
		`#!/usr/bin/env node\nconst fs=require('node:fs');const q=JSON.parse(fs.readFileSync(process.env.PROOF));const p=process.argv[3];if(p.includes('/pulls?'))console.log(JSON.stringify([{merged_at:'now',merge_commit_sha:process.env.GITHUB_SHA,base:{repo:{full_name:'owner/repo'},ref:'main'},head:{repo:{full_name:'owner/repo'},sha:'${"c".repeat(40)}'}}]));else if(p.endsWith('/999'))console.log('42');else if(p.includes('/artifacts?'))console.log(JSON.stringify({artifacts:[{name:q.name,expired:false}]}));else console.log(JSON.stringify({workflow_runs:[{id:888,event:'pull_request',head_sha:'${"c".repeat(40)}',repository:{full_name:'owner/repo'},head_repository:{full_name:'owner/repo'},status:'completed',conclusion:q.conclusion,run_attempt:2}]}));\n`,
	);
	fs.chmodSync(join(bin, "gh"), 0o755);
	for (const [name, conclusion, reuse] of [
		[`ci-tree-v1-ci-${tree}-2`, "success", true],
		[`ci-tree-v1-prepare-${tree}-2`, "success", false],
		[`ci-tree-v1-ci-${tree}-1`, "success", false],
		[`ci-tree-v1-ci-${tree}-2`, "failure", false],
	]) {
		fs.writeFileSync(proof, JSON.stringify({ name, conclusion }));
		fs.writeFileSync(env.GITHUB_OUTPUT, "");
		execFileSync("bash", [join(process.cwd(), "scripts/ci-verified-tree.sh")], {
			cwd: f.root,
			env,
		});
		assert.ok(
			fs.readFileSync(env.GITHUB_OUTPUT, "utf8").includes(`run_full=${!reuse}`),
		);
	}
});

it("cost-based shards retain every discovered and new file independently of discovery order", async () => {
	const { default: Sequencer } = await import("../ci-built-sequencer.mjs");
	const root = process.cwd();
	const discovered = JSON.parse(
		execFileSync(
			process.execPath,
			[
				"node_modules/vitest/vitest.mjs",
				"list",
				"--config",
				"config/testing/vitest.config.mjs",
				"--filesOnly",
				"--json",
			],
			{ env: { ...process.env, TEST_SUITE: "built" }, encoding: "utf8" },
		),
	);
	const files = [
		...discovered.map(({ file }) => ({ moduleId: file })),
		{ moduleId: join(root, "scripts/built/new-scenario.test.mjs") },
	];
	const first = new Sequencer({
		config: { root, shard: { index: 1, count: 2 } },
	});
	const second = new Sequencer({
		config: { root, shard: { index: 2, count: 2 } },
	});
	const a = first.shard(files),
		b = second.shard(files);
	assert.deepEqual(first.shard([...files].reverse()), a);
	assert.deepEqual(second.shard([...files].reverse()), b);
	assert.equal(new Set([...a, ...b]).size, files.length);
	assert.deepEqual(
		[...a, ...b]
			.map((f) => f.moduleId)
			.sort((left, right) => left.localeCompare(right)),
		files
			.map((f) => f.moduleId)
			.sort((left, right) => left.localeCompare(right)),
	);
	assert.ok(a.length > 0 && b.length > 0);
	assert.ok(
		Math.abs(
			a.reduce((sum, f) => sum + first.cost(f), 0) -
				b.reduce((sum, f) => sum + first.cost(f), 0),
		) <= Math.max(...files.map((f) => first.cost(f))),
	);
});

it("the pinned Vitest runner executes complete disjoint real fixture shards", (t) => {
	const f = fixture(t);
	const built = join(f.root, "scripts/built");
	fs.mkdirSync(built, { recursive: true });
	fs.mkdirSync(join(f.root, "node_modules"));
	// Share only the installed package, leaving fixture-owned mutable caches.
	fs.symlinkSync(
		join(process.cwd(), "node_modules/vitest"),
		join(f.root, "node_modules/vitest"),
		"dir",
	);
	const expected = ["one", "two", "three", "four"].map((name) =>
		join(built, `${name}.test.mjs`),
	);
	for (const file of expected)
		fs.writeFileSync(
			file,
			`import {it} from 'vitest'; it('fixture executes', () => {});`,
		);
	// Vitest list --filesOnly ignores sharding. Execute tiny owned fixtures to
	// exercise the real runner/sequencer API instead of accepting discovery alone.
	const lists = [1, 2].map((shard) => {
		const output = join(f.directory, `report-${shard}.json`);
		execFileSync(
			process.execPath,
			[
				join(process.cwd(), "node_modules/vitest/vitest.mjs"),
				"run",
				"--config",
				join(process.cwd(), "config/testing/ci-built.config.mjs"),
				"--root",
				f.root,
				`--shard=${shard}/2`,
				"--reporter=json",
				`--outputFile=${output}`,
			],
			{
				cwd: f.root,
				env: { ...process.env, TEST_SUITE: "built" },
				stdio: "pipe",
			},
		);
		const result = JSON.parse(fs.readFileSync(output, "utf8"));
		assert.equal(result.numPassedTests, 2);
		return result.testResults.map((row) => row.name);
	});
	assert.deepEqual(
		lists.flat().sort((left, right) => left.localeCompare(right)),
		expected.sort((left, right) => left.localeCompare(right)),
	);
	assert.equal(new Set(lists.flat()).size, expected.length);
});

it("preparation owns the authoritative full or reuse decision and binds consumers to checkout and attempt", () => {
	const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };
	for (const mode of ["full", "reuse"])
		assert.equal(verifyPreparation({ identity: id, mode }, id, env), mode);
	for (const field of ["sha", "tree", "run", "attempt"])
		assert.throws(() =>
			verifyPreparation(
				{ identity: { ...id, [field]: "stale" }, mode: "full" },
				id,
				env,
			),
		);
	assert.throws(() =>
		verifyPreparation({ identity: id, mode: "unknown" }, id, env),
	);
	assert.throws(() =>
		verifyPreparation({ identity: id, mode: "reuse" }, id, {
			GITHUB_EVENT_NAME: "pull_request",
			GITHUB_REF: "refs/pull/163/merge",
		}),
	);
	// Shards have no independent proof decision: both paths consume this record.
	const workflow = parse(fs.readFileSync(".github/workflows/ci.yml", "utf8"));
	assert.ok(
		!workflow.jobs.built.steps.some((step) =>
			step.run?.includes("ci-verified-tree.sh"),
		),
	);
	const select = workflow.jobs.built.steps.findIndex(
		(step) => step.id === "preparation",
	);
	const execute = workflow.jobs.built.steps.findIndex(
		(step) => step.name === "Run built shard",
	);
	assert.ok(select > 0 && execute > select);
	assert.equal(
		workflow.jobs.built.steps[execute].if,
		"steps.preparation.outputs.run_full == 'true'",
	);
});
