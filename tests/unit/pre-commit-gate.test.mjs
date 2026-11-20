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
import { SHELL_MISSING_EXIT } from "../../gate/provision-chromium.js";
import {
	NO_BROWSER_SKIPPED,
	NO_BROWSER_WARNING,
} from "../../gate/run-gate.mjs";

const run = promisify(exec);
const project = process.cwd();
// The caller's own downloads setting, in any form Playwright reads, stays out of the fixture.
const SKIP_DOWNLOAD_FORMS = new Set(
	["", "npm_config_", "npm_package_config_"].map(
		(prefix) => `${prefix}playwright_skip_browser_download`,
	),
);
async function fixture(t) {
	const temp = await mkdtemp(path.join(os.tmpdir(), "pre-commit-gate-"));
	t.onTestFinished(() => rm(temp, { recursive: true, force: true }));
	const root = path.join(temp, "repo");
	const bin = path.join(temp, "bin");
	await mkdir(path.join(root, ".git-hooks"), { recursive: true });
	await mkdir(path.join(root, "gate"));
	await mkdir(path.join(root, "node_modules"));
	await Promise.all(
		[
			"run-gate.mjs",
			"gate-snapshot.mjs",
			"gate-processes.mjs",
			"provision-chromium.ts",
		].map((name) =>
			copyFile(path.join(project, "gate", name), path.join(root, "gate", name)),
		),
	);
	await mkdir(path.join(root, "src/components"), { recursive: true });
	await mkdir(bin);
	await copyFile(
		path.join(project, ".git-hooks/pre-commit"),
		path.join(root, ".git-hooks/pre-commit"),
	);
	await writeFile(
		path.join(root, "src/components/Example.svelte"),
		"<p>Before</p>\n",
	);
	const receipt = path.join(temp, "calls");
	const lib = path.join(root, "gate/gate-lib.sh");
	await writeFile(
		lib,
		`gate_enter_committing_tree() { ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"; }\ngate_begin_commit() { echo bootstrap >> "$RECEIPT"; }\ngate_check_bash_floor() { :; }\ngate_require_node() { :; }\nrun_step() { shift; "$@"; }\n`,
	);
	await writeFile(
		path.join(root, "gate/repo-python.sh"),
		`#!/usr/bin/env bash\nprintf 'trust-fixtures\\n' >> "$RECEIPT"\n`,
	);
	await Promise.all(
		["npm", "npx"].map(async (command) => {
			const file = path.join(bin, command);
			await writeFile(
				file,
				`#!/usr/bin/env bash\nprintf '%s\\n' '${command} '"$*" >> "$RECEIPT"\n`,
			);
			await chmod(file, 0o755);
		}),
	);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) =>
				!key.startsWith("GIT_") &&
				!key.startsWith("FLEET_") &&
				key !== "CI" &&
				key !== "JSOLLY_INSTALL_BROWSER" &&
				!SKIP_DOWNLOAD_FORMS.has(key.toLowerCase()),
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
	});
	const git = (...args) => run("git", ["-C", root, ...args], { env });
	await git("init", "-b", "codex/gate");
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
		"gate/repo-python.sh",
		"gate/run-gate.mjs",
		"gate/gate-snapshot.mjs",
		"gate/gate-processes.mjs",
		"gate/provision-chromium.ts",
		"src/components/Example.svelte",
	);
	await git("-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
	const hook = (overrides) =>
		run("bash", [path.join(root, ".git-hooks/pre-commit")], {
			cwd: root,
			env: { ...env, ...overrides },
		});
	return { root, bin, hook, env, calls: () => readFile(receipt, "utf8") };
}

it("full gate retains build/browser steps", async (t) => {
	const f = await fixture(t);
	const packageJson = JSON.parse(
		await readFile(path.join(project, "package.json"), "utf8"),
	);
	assert.ok(packageJson.scripts.gate.startsWith("FLEET_DOC_FAST=0 "));
	const result = await f.hook();
	assert.ok(result.stdout.includes("pre-commit gate passed"));
	const calls = await f.calls();
	assert.ok(calls.includes("npm run --silent browser:check\n"));
	assert.ok(calls.includes("npm run build\n"));
	assert.ok(calls.includes("npm run test:built\n"));
	assert.ok(calls.includes("npm run test:python\n"));
});

async function browserSetupFixture(t) {
	const f = await fixture(t);
	await writeFile(
		path.join(f.bin, "npx"),
		`#!/usr/bin/env node
const fs = require("node:fs");
const {setTimeout} = require("node:timers/promises");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RECEIPT, "npx " + args.join(" ") + "\\n");
async function main() {
	if (!args.includes("playwright")) return;
	if (process.env.FAIL_BROWSER === "1") process.exit(43);
	for(let n=0; !fs.existsSync(process.env.RECEIPT + ".build") || !fs.existsSync(process.env.RECEIPT + ".unit"); n++) {
		if(n>500) throw Error("browser setup did not overlap build");
		await setTimeout(10);
	}
	fs.writeFileSync(process.env.RECEIPT + ".browser", "ready");
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
`,
	);
	await writeFile(
		path.join(f.bin, "npm"),
		`#!/usr/bin/env node
const fs = require("node:fs");
const command = process.argv.slice(2).join(" ");
fs.appendFileSync(process.env.RECEIPT, "npm " + command + "\\n");
if (command === "run --silent browser:check" && process.env.BROWSER_CHECK_EXIT) {
	console.error("browser missing; run npm run browser:install");
	process.exit(Number(process.env.BROWSER_CHECK_EXIT));
}
if (command === "run build") fs.writeFileSync(process.env.RECEIPT + ".build", "built");
if (command === "test") fs.writeFileSync(process.env.RECEIPT + ".unit", "tested");
if (["run smoke:scenario-contract", "run test:built"].includes(command) && !fs.existsSync(process.env.RECEIPT + ".browser")) {
	console.error("browser-dependent check started before installation");
	process.exitCode=41;
}
`,
	);
	return f;
}

it("CI browser setup overlaps build and gates every browser-dependent suite", async (t) => {
	const f = await browserSetupFixture(t);
	const result = await f.hook({
		JSOLLY_INSTALL_BROWSER: "1",
	});
	assert.ok(result.stdout.includes("pre-commit gate passed"));
	const calls = await f.calls();
	// TEMPORARY: no `--with-deps` while the arm runner cannot reach ports.ubuntu.com; restore with
	// gate/run-gate.mjs and the workflows: https://app.todoist.com/app/task/6hxj7q93qR2WxXW5
	assert.ok(
		calls.includes(
			"npx --no-install playwright install --only-shell chromium\n",
		),
	);
	assert.ok(!calls.includes("browser:check"));
	assert.ok(calls.includes("npm test\n"));
	assert.ok(calls.includes("npm run smoke:scenario-contract\n"));
	assert.ok(calls.includes("npm run test:built\n"));
});

it("local gate without a provisioned browser skips only the browser suites, with the reason, where downloads are off", async (t) => {
	const f = await browserSetupFixture(t);
	const result = await f.hook({
		BROWSER_CHECK_EXIT: String(SHELL_MISSING_EXIT),
		PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
	});
	assert.ok(result.stdout.includes("pre-commit gate passed"));
	assert.ok(result.stderr.includes(NO_BROWSER_WARNING));
	assert.ok(result.stderr.includes(NO_BROWSER_SKIPPED));
	const calls = await f.calls();
	assert.ok(calls.includes("npm run --silent browser:check\n"));
	for (const retained of [
		"npm run check:yaml\n",
		"npm run check:md\n",
		"npm run build\n",
		"npm test\n",
		"npm run test:python\n",
		"npm run check:ts\n",
	])
		assert.ok(calls.includes(retained), retained);
	assert.ok(!calls.includes("npm run smoke:scenario-contract\n"));
	assert.ok(!calls.includes("npm run test:built\n"));
	assert.ok(!calls.includes("npx --no-install playwright"));
});

it("local gate with browser downloads on still fails before any check for a missing browser", async (t) => {
	const f = await browserSetupFixture(t);
	const missing = (error) =>
		error.code === SHELL_MISSING_EXIT &&
		error.stderr.includes("npm run browser:install");
	await assert.rejects(
		f.hook({ BROWSER_CHECK_EXIT: String(SHELL_MISSING_EXIT) }),
		missing,
	);
	await assert.rejects(
		f.hook({
			BROWSER_CHECK_EXIT: String(SHELL_MISSING_EXIT),
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0",
		}),
		missing,
	);
	const calls = await f.calls();
	assert.ok(!calls.includes("npm run build\n"));
	assert.ok(!calls.includes("npm test\n"));
});

it("local gate still fails before any check when the browser check fails for another reason", async (t) => {
	const f = await browserSetupFixture(t);
	await assert.rejects(
		f.hook({ BROWSER_CHECK_EXIT: "1", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" }),
		(error) =>
			error.code === 1 && error.stderr.includes("npm run browser:install"),
	);
	const calls = await f.calls();
	assert.ok(!calls.includes("npm run build\n"));
	assert.ok(!calls.includes("npm test\n"));
});

it("CI never skips the browser suites for a missing browser", async (t) => {
	const f = await browserSetupFixture(t);
	await assert.rejects(
		f.hook({
			BROWSER_CHECK_EXIT: String(SHELL_MISSING_EXIT),
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
			CI: "true",
		}),
		(error) => error.code === SHELL_MISSING_EXIT,
	);
	const calls = await f.calls();
	assert.ok(!calls.includes("npm run build\n"));
	assert.ok(!calls.includes("npm test\n"));
});

it("failed CI browser setup fails the full gate without starting browser-dependent suites", async (t) => {
	const f = await browserSetupFixture(t);
	await assert.rejects(
		f.hook({
			JSOLLY_INSTALL_BROWSER: "1",
			FAIL_BROWSER: "1",
		}),
		(error) => error.code === 43,
	);
	const calls = await f.calls();
	assert.ok(calls.includes("npm run build\n"));
	assert.ok(calls.includes("npm test\n"));
	assert.ok(!calls.includes("npm run smoke:scenario-contract\n"));
	assert.ok(!calls.includes("npm run test:built\n"));
});

async function preparationFixture(t) {
	const f = await browserSetupFixture(t);
	const probe = path.join(f.root, "gate/preparation-probe.mjs");
	await writeFile(
		probe,
		`import {runPreparation} from './run-gate.mjs'; await runPreparation(new URL('..', import.meta.url).pathname);`,
	);
	return {
		...f,
		prepare: (overrides) =>
			run(process.execPath, [probe], {
				cwd: f.root,
				env: { ...f.env, JSOLLY_INSTALL_BROWSER: "1", ...overrides },
			}),
	};
}

it("CI preparation retains independent checks and browser readiness without accepting built coverage", async (t) => {
	const f = await preparationFixture(t);
	await f.prepare();
	const calls = await f.calls();
	assert.ok(calls.includes("npm run build\n"));
	assert.ok(calls.includes("npm test\n"));
	assert.ok(calls.includes("npm run test:python\n"));
	assert.ok(calls.includes("npm run smoke:scenario-contract\n"));
	assert.ok(!calls.includes("npm run test:built\n"));
});

it("CI preparation fails browser provisioning without starting smoke contracts", async (t) => {
	const f = await preparationFixture(t);
	await assert.rejects(f.prepare({ FAIL_BROWSER: "1" }));
	assert.ok(!(await f.calls()).includes("npm run smoke:scenario-contract\n"));
});

it("CI preparation rejects source mutation after all private checks settle", async (t) => {
	const f = await preparationFixture(t);
	const npm = path.join(f.bin, "npm");
	await writeFile(
		npm,
		(await readFile(npm, "utf8")) +
			`\nif(command === "run build")fs.appendFileSync("src/components/Example.svelte", "changed");\n`,
	);
	await assert.rejects(f.prepare(), (error) =>
		error.stderr.includes("changed"),
	);
});

it("CI preparation shell refuses runtime-check failures before executing its partial scheduler", async (t) => {
	const f = await fixture(t);
	await copyFile(
		path.join(project, "gate/ci-prepare.sh"),
		path.join(f.root, "gate/ci-prepare.sh"),
	);
	await writeFile(
		path.join(f.root, "gate/ci-gate.mjs"),
		"throw Error('scheduler must not start');",
	);
	for (const failing of ["gate_check_bash_floor", "gate_require_node"]) {
		// biome-ignore lint/performance/noAwaitInLoops: Each runtime failure replaces the same isolated shell fixture.
		await writeFile(
			path.join(f.root, "gate/gate-lib.sh"),
			`run_step() { shift; "$@"; }\ngate_check_bash_floor() { :; }\ngate_require_node() { :; }\n${failing}() { return 23; }\n`,
		);
		await assert.rejects(
			run("bash", [path.join(f.root, "gate/ci-prepare.sh")], {
				cwd: f.root,
				env: f.env,
			}),
			(error) =>
				error.code === 23 && !error.stderr.includes("scheduler must not start"),
		);
	}
});
