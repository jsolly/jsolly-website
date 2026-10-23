// biome-ignore-all lint/performance/noAwaitInLoops: Commands within a validation chain must retain their dependency order.
// Build and built tests keep their original output owner. Independent checks run
// in private source trees; a green gate requires every command and an unchanged
// source/index. No test results are cached or reused.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { terminateOwners } from "./gate-processes.mjs";
import {
	assertUnchanged,
	createValidationTree,
	privateEnvironment,
	snapshot,
} from "./gate-snapshot.mjs";

const chains = [
	{
		name: "static",
		commands: [
			[
				"biome ci",
				"npx",
				"--no-install",
				"biome",
				"ci",
				"--config-path=config/quality/biome.settings.jsonc",
				".",
				"--error-on-warnings",
			],
			["yaml lint", "npm", "run", "check:yaml"],
			["knip", "npm", "run", "check:knip"],
			["legacy redirects", "npm", "run", "redirects:check"],
			["recipe data", "npm", "run", "recipes:check"],
			["actionlint", "npm", "run", "check:actions"],
			["markdown lint", "npm", "run", "check:md"],
		],
	},
	{
		name: "types",
		commands: [["types (astro + svelte)", "npm", "run", "check:ts"]],
	},
	{
		name: "unit",
		commands: [
			["unit tests", "npm", "test"],
			["repository hook trust", "npm", "run", "test:python"],
		],
	},
	{
		name: "smoke",
		commands: [["smoke scenario", "npm", "run", "smoke:scenario-contract"]],
	},
];
const buildCommands = [
	["build", "npm", "run", "build"],
	["built tests", "npm", "run", "test:built"],
];

export async function runChains(
	work,
	logs,
	{ env = process.env, signal } = {},
) {
	const active = new Map();
	const owners = new Set();
	let cancelled = signal?.aborted;
	let termination;
	const kill = (child, sig) => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, sig);
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	};
	// Capture detached descendants while their owners are still alive, allow
	// cleanup handlers to run, then verify termination before tree cleanup.
	const cancel = () => {
		cancelled = true;
		termination ??= terminateOwners([...owners]);
		// Observe failures immediately; the finally block awaits and reports them.
		termination.catch(() => {
			for (const child of active.keys()) kill(child, "SIGKILL");
		});
	};
	signal?.addEventListener("abort", cancel);
	try {
		const results = await Promise.all(
			work
				.map(async ({ name, cwd, commands, privateTree }) => {
					const log = join(logs, `${name}.log`);
					const childEnv = privateTree ? privateEnvironment(env) : { ...env };
					if (env.NODE_COMPILE_CACHE)
						childEnv.NODE_COMPILE_CACHE = join(logs, "node-cache", name);
					for (const [label, command, ...args] of commands) {
						if (cancelled) throw new Error("Gate cancelled");
						console.log(`• ${label}`);
						const fd = openSync(log, "a");
						let child;
						let result;
						const owner = [childEnv.JSOLLY_GATE_OWNER, randomUUID()]
							.filter(Boolean)
							.join(",");
						try {
							result = await new Promise((resolve) => {
								child = spawn(command, args, {
									cwd,
									env: { ...childEnv, JSOLLY_GATE_OWNER: owner },
									detached: true,
									stdio: ["ignore", fd, fd],
								});
								active.set(child, owner);
								owners.add(owner);
								child.once("error", (error) => resolve({ error }));
								child.once("close", (code, childSignal) =>
									resolve({ code, signal: childSignal }),
								);
							});
						} finally {
							closeSync(fd);
							if (child) {
								if (!cancelled && (result?.error || result?.code !== 0))
									await terminateOwners([owner]);
								active.delete(child);
							}
						}
						if (result.error || result.code !== 0 || cancelled) {
							console.error(await fs.readFile(log, "utf8"));
							return {
								name,
								code: result.code || 1,
								message: `${label}: ${result.error?.message ?? result.signal ?? result.code}`,
							};
						}
					}
					return { name, code: 0 };
				})
				.map((promise) =>
					promise.catch((error) => ({ code: 1, message: error.message })),
				),
		);
		if (cancelled) throw new Error("Gate cancelled");
		const failed = results.find((result) => result.code !== 0);
		if (failed)
			throw Object.assign(new Error(`Gate failed: ${failed.message}`), {
				exitCode: failed.code,
			});
	} finally {
		try {
			// One final ownership scan covers successful commands, including their
			// detached survivors. Failures and cancellation are cleaned immediately.
			await (termination ?? terminateOwners([...owners]));
		} finally {
			signal?.removeEventListener("abort", cancel);
		}
	}
	if (signal?.aborted) throw new Error("Gate cancelled");
}

export async function runGate(root) {
	const source = await snapshot(root);
	const scratch = await fs.mkdtemp(join(tmpdir(), "jsolly-gate-"));
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	let passed = false;
	try {
		const work = [];
		for (const chain of chains) {
			if (controller.signal.aborted) throw new Error("Gate cancelled");
			const cwd = await createValidationTree(
				root,
				join(scratch, chain.name),
				source,
			);
			work.push({ ...chain, cwd, privateTree: true });
		}
		work.push({ name: "build", cwd: root, commands: buildCommands });
		await assertUnchanged(root, source);
		await runChains(work, scratch, { signal: controller.signal });
		await assertUnchanged(root, source);
		passed = true;
	} catch (error) {
		console.error(`Gate diagnostics retained at ${scratch}`);
		throw error;
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
		// Failure trees and logs remain available for diagnosis. Successful runs
		// leave dist/, .recipe-browse/ and generated route/types in their normal owner.
		if (passed) await fs.rm(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await runGate(fileURLToPath(new URL("..", import.meta.url)));
	} catch (error) {
		console.error(error.message);
		process.exitCode = error.exitCode ?? 1;
	}
}
