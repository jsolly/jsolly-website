// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone native verification CLI intentionally asserts outside a test framework.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withOfflineNodeGuard } from "../guard.ts";
import { requireControlReceipt } from "./receipts.ts";

const controls = [
	"positive",
	"tls-positive",
	"fetch-redirect",
	"ipc",
	"fresh-env",
	"deny-net",
	"deny-http",
	"deny-tls",
	"deny-https",
	"worker",
	"fork",
];
for (const scenario of controls) {
	const child = spawn(
		process.execPath,
		[fileURLToPath(new URL("./fixture.ts", import.meta.url))],
		{
			env: withOfflineNodeGuard({ NODE_CONTROL_CASE: scenario }),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
	const deadline = setTimeout(() => child.kill("SIGKILL"), 15_000);
	// biome-ignore lint/performance/noAwaitInLoops: Run bounded child controls serially to preserve isolated process receipts.
	const result = await new Promise<{
		code: number | null;
		signal: string | null;
	}>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => resolve({ code, signal }));
	}).finally(() => clearTimeout(deadline));
	assert.equal(result.signal, null, `${scenario}: ${stderr}`);
	assert.equal(result.code, scenario.startsWith("deny-") ? 1 : 0, stderr);
	assert.ok(child.pid);
	requireControlReceipt(
		stdout,
		scenario,
		child.pid,
		scenario.startsWith("deny-"),
	);
	assert.equal(child.exitCode, result.code);
	process.stdout.write(
		`${JSON.stringify({ scenario, pid: child.pid, ...result, stdout, stderr })}\n`,
	);
}
