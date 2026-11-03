import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executeTransportDeadline } from "./scenario.ts";
import type { DeadlineRequest } from "./types.ts";
import { parseDeadlineOutcome } from "./types.ts";

export async function supervisedTransportDeadline(options: DeadlineRequest) {
	// macOS keeps its existing direct execution. Linux container PID 1 may not
	// reap orphaned grandchildren, so a test-owned ancestor takes that duty.
	if (process.platform !== "linux") return executeTransportDeadline(options);
	const result = await new Promise<string>((resolve, reject) => {
		const supervisor = spawn(
			"python3",
			[
				fileURLToPath(new URL("./supervisor.py", import.meta.url)),
				process.execPath,
				fileURLToPath(new URL("./scenario.ts", import.meta.url)),
				JSON.stringify(options),
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		supervisor.stdout.on("data", (bytes: Buffer) => {
			stdout += bytes.toString();
		});
		supervisor.stderr.on("data", (bytes: Buffer) => {
			stderr += bytes.toString();
		});
		supervisor.once("error", reject);
		supervisor.once("close", (code, signal) => {
			if (code !== 0) {
				reject(
					new Error(
						`Transport fixture supervisor failed (${signal ?? code}): ${stderr.trim()}`,
					),
				);
				return;
			}
			resolve(stdout);
		});
	});
	const parsed: unknown = JSON.parse(result);
	const outcome = parseDeadlineOutcome(parsed);
	if (outcome.kind === "rejected") {
		throw Object.assign(
			new Error(outcome.message),
			outcome.transient === undefined ? {} : { transient: outcome.transient },
		);
	}
}
