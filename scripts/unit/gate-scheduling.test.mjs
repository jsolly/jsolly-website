// biome-ignore-all lint/performance/noAwaitInLoops: These bounded polls wait for observable cross-process state.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { it } from "vitest";
import { terminateOwners } from "../gate-processes.mjs";
import {
	assertUnchanged,
	createValidationTree,
	privateEnvironment,
	snapshot,
} from "../gate-snapshot.mjs";
import { runChains } from "../run-gate.mjs";

const CHANGED = /changed/u;
const INDEX_CHANGED = /staged index changed/u;
const MISSING = /ENOENT/u;
const SIGNAL = /SIGTERM/u;
const CANCELLED = /cancelled/u;
const FIELDS = /\s+/u;

async function fixture(t) {
	const dir = await fs.mkdtemp(join(tmpdir(), "gate-contract-"));
	t.onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
	const root = join(dir, "source");
	await fs.mkdir(root);
	const env = {
		...privateEnvironment(),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	};
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: root,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-q");
	await fs.writeFile(join(root, "tracked"), "committed");
	await fs.writeFile(join(root, ".gitignore"), "node_modules/\n");
	git("add", "tracked", ".gitignore");
	git(
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-qm",
		"fixture",
	);
	await fs.mkdir(join(root, "node_modules"));
	return { dir, root, env, git };
}

it("copies effective alternate index, unstaged bytes, additions and deletions into independent Git metadata", async (t) => {
	const f = await fixture(t);
	const alternate = join(f.dir, "alternate-index");
	await fs.copyFile(join(f.root, ".git/index"), alternate);
	const env = {
		...f.env,
		GIT_INDEX_FILE: alternate,
		GIT_DIR: join(f.root, ".git"),
		GIT_WORK_TREE: f.root,
		GIT_COMMON_DIR: join(f.root, ".git"),
	};
	await fs.writeFile(join(f.root, "tracked"), "staged");
	execFileSync("git", ["add", "tracked"], { cwd: f.root, env });
	await fs.writeFile(join(f.root, "tracked"), "working");
	await fs.writeFile(join(f.root, "new"), "untracked");
	await fs.rm(join(f.root, ".gitignore"));
	const before = await snapshot(f.root, env);
	const copy = await createValidationTree(
		f.root,
		join(f.dir, "copy"),
		before,
		env,
	);
	const privateGit = (...args) =>
		execFileSync("git", args, {
			cwd: copy,
			env: privateEnvironment(env),
			encoding: "utf8",
		}).trim();
	assert.equal(privateGit("show", ":tracked"), "staged");
	assert.equal(privateGit("show", "HEAD:tracked"), "committed");
	assert.equal(await fs.readFile(join(copy, "tracked"), "utf8"), "working");
	assert.equal(await fs.readFile(join(copy, "new"), "utf8"), "untracked");
	await assert.rejects(fs.stat(join(copy, ".gitignore")), { code: "ENOENT" });
	assert.equal(f.git("show", ":tracked"), "committed");
	await assertUnchanged(f.root, before, env);
});

it("keeps dependency caches private and preserves executable source modes", async (t) => {
	const f = await fixture(t);
	await fs.mkdir(join(f.root, "node_modules/.vite"));
	await fs.writeFile(join(f.root, "node_modules/.vite/original"), "untouched");
	await fs.mkdir(join(f.root, "node_modules/package"));
	await fs.writeFile(join(f.root, "tool"), "source");
	await fs.chmod(join(f.root, "tool"), 0o755);
	const copy = await createValidationTree(
		f.root,
		join(f.dir, "copy"),
		await snapshot(f.root, f.env),
		f.env,
	);
	await fs.mkdir(join(copy, "node_modules/.vite"));
	await fs.writeFile(join(copy, "node_modules/.vite/original"), "private");
	assert.equal(
		await fs.readFile(join(f.root, "node_modules/.vite/original"), "utf8"),
		"untouched",
	);
	assert.ok(
		(await fs.lstat(join(copy, "node_modules/package"))).isSymbolicLink(),
	);
	assert.equal((await fs.stat(join(copy, "tool"))).mode & 0o777, 0o755);
});

it("rejects index-only changes while working source and HEAD stay identical", async (t) => {
	const f = await fixture(t);
	await fs.writeFile(join(f.root, "tracked"), "working");
	const before = await snapshot(f.root, f.env);
	f.git("add", "tracked");
	await assert.rejects(assertUnchanged(f.root, before, f.env), INDEX_CHANGED);
});

it("rejects source additions, edits and deletions", async (t) => {
	const f = await fixture(t);
	const before = await snapshot(f.root, f.env);
	await fs.writeFile(join(f.root, "new"), "added");
	await assert.rejects(assertUnchanged(f.root, before, f.env), CHANGED);
	await fs.rm(join(f.root, "new"));
	await fs.writeFile(join(f.root, "tracked"), "edited");
	await assert.rejects(assertUnchanged(f.root, before, f.env), CHANGED);
	await fs.rm(join(f.root, "tracked"));
	await assert.rejects(assertUnchanged(f.root, before, f.env), CHANGED);
});

it("rejects a HEAD-only change with identical index and source bytes", async (t) => {
	const f = await fixture(t);
	const before = await snapshot(f.root, f.env);
	f.git(
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--allow-empty",
		"-qm",
		"move HEAD",
	);
	await assert.rejects(assertUnchanged(f.root, before, f.env), CHANGED);
});

function command(label, code) {
	return [label, process.execPath, "--input-type=module", "-e", code];
}

it("overlaps independent chains but waits for build before built assertions", async (t) => {
	const f = await fixture(t);
	// A real cross-process barrier would deadlock a serial scheduler. Each
	// process publishes readiness, then waits for the other before continuing.
	const barrier = (mine, other) =>
		`import fs from 'node:fs/promises'; import {setTimeout} from 'node:timers/promises'; await fs.writeFile('${mine}','ready'); for(let n=0;;n++){try{await fs.stat('${other}');break;}catch(e){if(e.code!=='ENOENT')throw e;}if(n>500)throw Error('chains did not overlap');await setTimeout(10);}`;
	await runChains(
		[
			{
				name: "build",
				cwd: f.dir,
				commands: [
					command(
						"build",
						barrier("build-ready", "types-ready") +
							"await fs.writeFile('output','built');",
					),
					command(
						"built",
						// biome-ignore lint/security/noSecrets: Executable test fixture source, no credentials.
						"import fs from 'node:fs/promises'; if(await fs.readFile('output','utf8')!=='built')throw Error('build missing');",
					),
				],
			},
			{
				name: "types",
				cwd: f.dir,
				commands: [command("types", barrier("types-ready", "build-ready"))],
			},
		],
		f.dir,
	);
	assert.equal(await fs.readFile(join(f.dir, "output"), "utf8"), "built");
});

it("preserves nonzero exit status, stops that chain, and settles the other chain", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		runChains(
			[
				{
					name: "bad",
					cwd: f.dir,
					commands: [
						command("failure", "process.exit(37)"),
						command("must not run", "throw Error('unreachable')"),
					],
				},
				{
					name: "other",
					cwd: f.dir,
					commands: [
						command(
							"other",
							"import fs from 'node:fs/promises'; await fs.writeFile('settled','yes')",
						),
					],
				},
			],
			f.dir,
		),
		(error) => error.exitCode === 37,
	);
	assert.equal(await fs.readFile(join(f.dir, "settled"), "utf8"), "yes");
});

it("fails closed on spawn errors and signal-terminated commands", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		runChains(
			[
				{
					name: "absent",
					cwd: f.dir,
					commands: [["absent", join(f.dir, "missing-executable")]],
				},
			],
			f.dir,
		),
		MISSING,
	);
	await assert.rejects(
		runChains(
			[
				{
					name: "signal",
					cwd: f.dir,
					commands: [command("signal", "process.kill(process.pid,'SIGTERM')")],
				},
			],
			f.dir,
		),
		SIGNAL,
	);
});

async function cancelAndConfirm(t, code) {
	const f = await fixture(t);
	const controller = new AbortController();
	const running = runChains(
		[{ name: "cancel", cwd: f.dir, commands: [command("cancel", code)] }],
		f.dir,
		{ signal: controller.signal },
	);
	let failure;
	running.catch((error) => {
		failure = error;
	});
	try {
		let pid;
		for (let n = 0; n < 500; n++) {
			if (failure) throw failure;
			try {
				pid = Number(await fs.readFile(join(f.dir, "descendant"), "utf8"));
				break;
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await delay(10);
		}
		// biome-ignore lint/suspicious/noMisplacedAssertion: Shared helper is awaited by each cancellation test.
		assert.ok(pid);
		controller.abort();
		// biome-ignore lint/suspicious/noMisplacedAssertion: Shared helper is awaited by each cancellation test.
		await assert.rejects(running, CANCELLED);
		// The scheduler itself must have waited for termination. A zombie has
		// exited and cannot use files; its OS-owned reaping may follow separately.
		const result = execFileSync("ps", ["-axo", "pid=,stat="], {
			encoding: "utf8",
		});
		const row = result
			.split("\n")
			.map((line) => line.trim().split(FIELDS))
			.find(([id]) => Number(id) === pid);
		// biome-ignore lint/suspicious/noMisplacedAssertion: Shared helper is awaited by each cancellation test.
		assert.ok(
			!row || row[1].startsWith("Z"),
			`owned descendant ${pid} survived cancellation`,
		);
	} finally {
		controller.abort();
		await running.catch(() => {
			/* Cancellation is asserted above; teardown only settles ownership. */
		});
	}
}

for (const detached of [false, true]) {
	it(`cancellation awaits an owned ${detached ? "detached" : "same-group"} descendant`, async (t) => {
		await cancelAndConfirm(
			t,
			`import {spawn} from 'node:child_process'; import fs from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:${detached}}); fs.writeFileSync('descendant',String(child.pid)); setInterval(()=>{},1000)`,
		);
	});
}

it("failed command cleanup awaits its already-orphaned detached child", async (t) => {
	const f = await fixture(t);
	// The parent records the child PID then dies immediately. No ancestry polling
	// interval is assumed between detached launch and owner termination.
	const code =
		// biome-ignore lint/security/noSecrets: Executable process fixture source, no credentials.
		"import {spawn} from 'node:child_process'; import fs from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); fs.writeFileSync('orphan',String(child.pid)); process.kill(process.pid,'SIGTERM');";
	await assert.rejects(
		runChains(
			[
				{
					name: "failed-owner",
					cwd: f.dir,
					commands: [command("failed owner", code)],
				},
			],
			f.dir,
		),
		SIGNAL,
	);
	const pid = Number(await fs.readFile(join(f.dir, "orphan"), "utf8"));
	const rows = execFileSync("ps", ["-axo", "pid=,stat="], { encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim().split(FIELDS));
	const row = rows.find(([id]) => Number(id) === pid);
	assert.ok(
		!row || row[1].startsWith("Z"),
		`orphan ${pid} survived failed command`,
	);
});

it("process enumeration fails closed without exposing subprocess environment bytes", async (t) => {
	const f = await fixture(t);
	const bin = join(f.dir, "bin");
	await fs.mkdir(bin);
	await fs.writeFile(
		join(bin, "ps"),
		"#!/usr/bin/env node\nprocess.stdout.write('private-environment-fixture');process.stderr.write('private-environment-fixture');process.exit(7);\n",
		{ mode: 0o755 },
	);
	const previous = process.env.PATH;
	process.env.PATH = `${bin}:${previous}`;
	try {
		await assert.rejects(terminateOwners(["fixture-owner"]), (error) => {
			assert.equal(
				error.message,
				"Cannot enumerate owned gate processes; ps failed.",
			);
			assert.equal(error.cause, undefined);
			assert.equal(error.stdout, undefined);
			assert.equal(error.stderr, undefined);
			return true;
		});
	} finally {
		process.env.PATH = previous;
	}
});

it("outer cleanup retains ownership of nested schedulers after their parent dies", async (t) => {
	const f = await fixture(t);
	const runner = new URL("../run-gate.mjs", import.meta.url).href;
	const child =
		// biome-ignore lint/security/noSecrets: Executable process fixture source, no credentials.
		"require('node:fs').writeFileSync('nested-pid',String(process.pid));setInterval(()=>{},1000)";
	const code = `import {runChains} from ${JSON.stringify(runner)}; import fs from 'node:fs/promises'; import {setTimeout} from 'node:timers/promises'; const pending=runChains([{name:'nested',cwd:process.cwd(),commands:[['nested',process.execPath,'-e',${JSON.stringify(child)}]]}],process.cwd());pending.catch(()=>{});for(let n=0;;n++){try{await fs.stat('nested-pid');break;}catch(e){if(e.code!=='ENOENT')throw e;}if(n>500)throw Error('nested child missing');await setTimeout(10);}process.kill(process.pid,'SIGTERM');`;
	await assert.rejects(
		runChains(
			[{ name: "outer", cwd: f.dir, commands: [command("outer", code)] }],
			f.dir,
		),
		SIGNAL,
	);
	const pid = Number(await fs.readFile(join(f.dir, "nested-pid"), "utf8"));
	const row = execFileSync("ps", ["-axo", "pid=,stat="], { encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim().split(FIELDS))
		.find(([id]) => Number(id) === pid);
	assert.ok(
		!row || row[1].startsWith("Z"),
		`nested child ${pid} survived outer failure`,
	);
});

it("successful commands also leave no detached descendants when the scheduler settles", async (t) => {
	const f = await fixture(t);
	const code =
		// biome-ignore lint/security/noSecrets: Executable process fixture source, no credentials.
		"import {spawn} from 'node:child_process'; import fs from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); fs.writeFileSync('success-child',String(child.pid));child.unref();";
	await runChains(
		[
			{
				name: "success-owner",
				cwd: f.dir,
				commands: [command("successful owner", code)],
			},
		],
		f.dir,
	);
	const pid = Number(await fs.readFile(join(f.dir, "success-child"), "utf8"));
	const row = execFileSync("ps", ["-axo", "pid=,stat="], { encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim().split(FIELDS))
		.find(([id]) => Number(id) === pid);
	assert.ok(
		!row || row[1].startsWith("Z"),
		`successful child ${pid} survived settlement`,
	);
});

it("abort during successful final cleanup cannot report a green scheduler", async (t) => {
	const f = await fixture(t);
	const controller = new AbortController();
	const child =
		// biome-ignore lint/security/noSecrets: Executable shutdown-race fixture, no credentials.
		"const fs=require('node:fs');process.on('SIGTERM',()=>fs.writeFileSync('stopping','yes'));fs.writeFileSync('child-ready','yes');setInterval(()=>{},1000)";
	const code = `import {spawn} from 'node:child_process'; import fs from 'node:fs/promises'; import {setTimeout} from 'node:timers/promises'; const child=spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore'});for(let n=0;;n++){try{await fs.stat('child-ready');break;}catch(e){if(e.code!=='ENOENT')throw e;}if(n>500)throw Error('child missing');await setTimeout(10);}child.unref();`;
	const running = runChains(
		[
			{
				name: "cleanup-race",
				cwd: f.dir,
				commands: [command("cleanup race", code)],
			},
		],
		f.dir,
		{ signal: controller.signal },
	);
	let failure;
	running.catch((error) => {
		failure = error;
	});
	try {
		let stopping = false;
		for (let n = 0; n < 500; n++) {
			if (failure) throw failure;
			try {
				await fs.stat(join(f.dir, "stopping"));
				stopping = true;
				break;
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await delay(10);
		}
		assert.ok(stopping, "final cleanup has begun");
		controller.abort();
		await assert.rejects(running, CANCELLED);
	} finally {
		controller.abort();
		await running.catch(() => {
			/* Settle all owned processes before fixture removal. */
		});
	}
});
