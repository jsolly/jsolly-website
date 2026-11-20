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
import {
	browserDownloadsDisabled,
	SHELL_MISSING_EXIT,
} from "./provision-chromium.ts";

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

// TEMPORARY: Claude Duet cloud sessions cannot provision Playwright's browser
// (dead PLAYWRIGHT_DOWNLOAD_HOST, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, and a proxy
// that refuses the download hosts). There, and only where browser downloads are
// switched off like that, a local gate without the shell skips the suites that
// launch it instead of failing. Anywhere else a missing shell still fails with
// the install command, and CI always installs the browser and never skips.
// Remove the skip when sessions can run a browser:
// https://app.todoist.com/app/task/6j3qXFvGP5QhCRP5
export const NO_BROWSER_SKIPPED =
	"⚠ The smoke scenario contract and built-output tests were skipped (see the warning above); CI runs them on the pull request.";
export const NO_BROWSER_WARNING = `⚠ No Chrome Headless Shell is installed and PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD switches browser downloads off, so this local gate SKIPS the smoke scenario contract and the built-output tests (one counted suite, so its non-browser files are skipped too).
  Why: some cloud agent sessions cannot download Playwright's browser; they point PLAYWRIGHT_DOWNLOAD_HOST at a dead address, set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, and their proxy refuses the download hosts.
  CI installs the browser and runs both on every pull request, and the required \`ci\` check still gates the merge.
  Where the download host is reachable, run \`npm run browser:install\` to run them locally.
  Tracking (remove this skip once sessions can run a browser): https://app.todoist.com/app/task/6j3qXFvGP5QhCRP5`;

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
				.map(async ({ name, cwd, commands, privateTree, ready }) => {
					await ready;
					const log = join(logs, `${name}.log`);
					const childEnv = privateTree ? privateEnvironment(env) : { ...env };
					if (env.NODE_COMPILE_CACHE)
						childEnv.NODE_COMPILE_CACHE = privateTree
							? join(logs, "node-cache", name)
							: join(env.NODE_COMPILE_CACHE, name);
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

async function runValidation(root, built) {
	const source = await snapshot(root);
	const scratch = await fs.mkdtemp(join(tmpdir(), "jsolly-gate-"));
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	let passed = false;
	try {
		const installMode = process.env.JSOLLY_INSTALL_BROWSER;
		if (![undefined, "0", "1"].includes(installMode))
			throw new Error("JSOLLY_INSTALL_BROWSER must be 1, 0 or unset.");
		// Without an install step, the browser is checked before any check starts.
		// A missing shell outside CI, where browser downloads are switched off,
		// skips the browser suites (NO_BROWSER_WARNING); anything else fails here.
		let browser = true;
		if (installMode !== "1") {
			try {
				await runChains(
					[
						{
							name: "browser-check",
							cwd: root,
							commands: [
								["browser check", "npm", "run", "--silent", "browser:check"],
							],
						},
					],
					scratch,
					{ signal: controller.signal },
				);
			} catch (error) {
				if (
					error.exitCode !== SHELL_MISSING_EXIT ||
					process.env.CI ||
					!browserDownloadsDisabled(process.env)
				)
					throw error;
				browser = false;
				console.warn(NO_BROWSER_WARNING);
			}
		}
		const work = [];
		for (const chain of chains) {
			if (controller.signal.aborted) throw new Error("Gate cancelled");
			if (!browser && chain.name === "smoke") continue;
			const cwd = await createValidationTree(
				root,
				join(scratch, chain.name),
				source,
			);
			work.push({ ...chain, cwd, privateTree: true });
		}
		await assertUnchanged(root, source);
		const options = { signal: controller.signal };
		const browserReady =
			installMode === "1"
				? runChains(
						[
							{
								name: "browser-install",
								cwd: root,
								commands: [
									[
										"browser installation",
										"npx",
										"--no-install",
										"playwright",
										"install",
										// TEMPORARY: no `--with-deps`. apt on the arm runner could not reach ports.ubuntu.com
										// on 2026-11-11. Restore with the workflow steps: https://app.todoist.com/app/task/6hxj7q93qR2WxXW5
										"--only-shell",
										"chromium",
									],
								],
							},
						],
						scratch,
						options,
					)
				: Promise.resolve();
		const buildReady = runChains(
			[{ name: "build", cwd: root, commands: [buildCommands[0]] }],
			scratch,
			options,
		);
		for (const phase of work) {
			if (phase.name === "smoke") phase.ready = browserReady;
		}
		if (built && browser)
			work.push({
				name: "built",
				cwd: root,
				commands: [buildCommands[1]],
				ready: Promise.all([browserReady, buildReady]),
			});
		const checks = runChains(work, scratch, options);
		const results = await Promise.allSettled([
			browserReady,
			buildReady,
			checks,
		]);
		const failure = results.find((result) => result.status === "rejected");
		if (failure) throw failure.reason;
		await assertUnchanged(root, source);
		passed = true;
		if (!browser) console.warn(NO_BROWSER_SKIPPED);
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

// Only this explicit CI entrypoint omits the built phase. The ordinary gate
// has no argument or environment shortcut that can accept partial validation.
export async function runPreparation(root) {
	await runValidation(root, false);
}

export async function runGate(root) {
	await runValidation(root, true);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await runGate(fileURLToPath(new URL("..", import.meta.url)));
	} catch (error) {
		console.error(error.message);
		process.exitCode = error.exitCode ?? 1;
	}
}
