import assert from "node:assert/strict";
import { execFile as exec } from "node:child_process";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { it } from "vitest";

const run = promisify(exec);
const project = process.cwd();
async function fixture(t) {
	const temp = await mkdtemp(path.join(os.tmpdir(), "preview-gate-"));
	t.onTestFinished(() => rm(temp, { recursive: true, force: true }));
	const root = path.join(temp, "repo");
	const bin = path.join(temp, "bin");
	await mkdir(path.join(root, ".git-hooks"), { recursive: true });
	await mkdir(path.join(root, "scripts"));
	await mkdir(path.join(root, "node_modules"));
	await Promise.all(
		["run-gate.mjs", "gate-snapshot.mjs", "gate-processes.mjs"].map((name) =>
			copyFile(
				path.join(project, "scripts", name),
				path.join(root, "scripts", name),
			),
		),
	);
	await mkdir(path.join(root, "src/components"), { recursive: true });
	await mkdir(bin);
	await copyFile(
		path.join(project, ".git-hooks/pre-commit"),
		path.join(root, ".git-hooks/pre-commit"),
	);
	await copyFile(
		path.join(project, "scripts/ui-preview-scope.mjs"),
		path.join(root, "scripts/ui-preview-scope.mjs"),
	);
	await writeFile(
		path.join(root, "src/components/Example.svelte"),
		"<p>Before</p>\n",
	);
	const receipt = path.join(temp, "calls");
	await mkdir(path.join(root, "gate"));
	const lib = path.join(root, "gate/gate-lib.sh");
	await writeFile(
		lib,
		`gate_enter_committing_tree() { ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"; }\ngate_begin_commit() { echo bootstrap >> "$RECEIPT"; [[ "\${FAIL_BOOTSTRAP:-0}" != 1 ]]; }\ngate_check_bash_floor() { :; }\ngate_require_node() { :; }\nrun_step() { shift; "$@"; }\n`,
	);
	await writeFile(
		path.join(root, "scripts/repo-python.sh"),
		`#!/usr/bin/env bash\nprintf 'trust-fixtures\\n' >> "$RECEIPT"\n`,
	);
	await Promise.all(
		["npm", "npx"].map(async (command) => {
			const file = path.join(bin, command);
			await writeFile(
				file,
				`#!/usr/bin/env bash\nprintf '%s\\n' '${command} '"$*" >> "$RECEIPT"\n[[ "\${FAIL_CHECK:-0}" != 1 ]]\n`,
			);
			await chmod(file, 0o755);
		}),
	);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) =>
				!key.startsWith("GIT_") && !key.startsWith("FLEET_") && key !== "CI",
		),
	);
	Object.assign(env, {
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.invalid",
		GIT_COMMITTER_NAME: "fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.invalid",
		RECEIPT: receipt,
		PATH: `${bin}:${env.PATH}`,
		FLEET_DOC_FAST: "0",
		FLEET_UI_PREVIEW: "1",
		FLEET_UI_PREVIEW_PR: "129",
	});
	const git = (...args) => run("git", ["-C", root, ...args], { env });
	await git("init", "-b", "codex/preview");
	const common = (
		await git("rev-parse", "--path-format=absolute", "--git-common-dir")
	).stdout.trim();
	if (!common.startsWith(`${await realpath(root)}${path.sep}`)) {
		throw new Error("fixture must own its Git directory");
	}
	await git(
		"add",
		".git-hooks/pre-commit",
		"gate/gate-lib.sh",
		"scripts/repo-python.sh",
		"scripts/ui-preview-scope.mjs",
		"scripts/run-gate.mjs",
		"scripts/gate-snapshot.mjs",
		"scripts/gate-processes.mjs",
		"src/components/Example.svelte",
	);
	await git("-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
	env.FLEET_UI_PREVIEW_HEAD = (await git("rev-parse", "HEAD")).stdout.trim();
	await writeFile(
		path.join(root, "src/components/Example.svelte"),
		"<p>After</p>\n",
	);
	const hook = (overrides) =>
		run("bash", [path.join(root, ".git-hooks/pre-commit")], {
			cwd: root,
			env: { ...env, ...overrides },
		});
	return { root, hook, calls: () => readFile(receipt, "utf8") };
}

it("preview hook runs bootstrap and quick checks, without the full build/browser suite", async (t) => {
	const f = await fixture(t);
	const result = await f.hook();
	assert.ok(result.stdout.includes("preview checks passed"));
	assert.equal(await f.calls(), "bootstrap\nnpm run check:preview\n");
});

it("preview hook rejects non-UI files and bootstrap/check failures", async (t) => {
	const f = await fixture(t);
	await writeFile(path.join(f.root, "package.json"), "{}\n");
	await assert.rejects(f.hook(), (error) =>
		error.stderr.includes("only Svelte components"),
	);
	await rm(path.join(f.root, "package.json"));
	await assert.rejects(f.hook({ FAIL_BOOTSTRAP: "1" }));
	await assert.rejects(f.hook({ FAIL_CHECK: "1" }));
});

it("preview shortcut refuses an absent repository gate", async (t) => {
	const f = await fixture(t);
	await rm(path.join(f.root, "gate/gate-lib.sh"));
	await assert.rejects(f.hook(), (error) =>
		error.stderr.includes("gate/gate-lib.sh"),
	);
});

it("full gate disables preview mode and retains build/browser steps", async (t) => {
	const f = await fixture(t);
	const packageJson = JSON.parse(
		await readFile(path.join(project, "package.json"), "utf8"),
	);
	assert.ok(
		packageJson.scripts.gate.startsWith("FLEET_UI_PREVIEW=0 FLEET_DOC_FAST=0 "),
	);
	const result = await f.hook({ FLEET_UI_PREVIEW: "0" });
	assert.ok(result.stdout.includes("pre-commit gate passed"));
	const calls = await f.calls();
	assert.ok(calls.includes("npm run build\n"));
	assert.ok(calls.includes("npm run test:built\n"));
	assert.ok(calls.includes("npm run test:python\n"));
	assert.ok(!calls.includes("npm run check:preview"));
});
