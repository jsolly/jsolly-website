// biome-ignore-all lint/performance/noAwaitInLoops: Poll actual Chromium readiness before cancellation.
// Real browser ownership is an integration boundary. Keep it in the built suite
// so pure unit checks can run while CI provisions Chromium.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { runChains } from "../../gate/run-gate.mjs";

const CANCELLED = /cancelled/u;
const FIELDS = /\s+/u;

it("cancellation also awaits Playwright's real detached Chromium process", async () => {
	const dir = await fs.mkdtemp(join(tmpdir(), "gate-chromium-"));
	const controller = new AbortController();
	const fixture = fileURLToPath(
		new URL("../fixtures/gate-browser-descendant.ts", import.meta.url),
	);
	const running = runChains(
		[
			{
				name: "chromium",
				cwd: dir,
				commands: [["Chromium ownership", process.execPath, fixture]],
			},
		],
		dir,
		{ signal: controller.signal },
	);
	let failure;
	running.catch((error) => {
		failure = error;
	});
	try {
		let pid;
		let observed = "";
		for (let n = 0; n < 500; n++) {
			if (failure) throw failure;
			try {
				observed = await fs.readFile(join(dir, "descendant"), "utf8");
				const value = Number(observed);
				// A partial write reads as 0. Keep waiting for the real pid.
				if (Number.isInteger(value) && value > 0) {
					pid = value;
					break;
				}
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await delay(10);
		}
		assert.ok(
			pid,
			`Chromium started (last descendant record: ${JSON.stringify(observed)})`,
		);
		controller.abort();
		await assert.rejects(running, CANCELLED);
		const row = execFileSync("ps", ["-axo", "pid=,stat="], { encoding: "utf8" })
			.split("\n")
			.map((line) => line.trim().split(FIELDS))
			.find(([id]) => Number(id) === pid);
		assert.ok(
			!row || row[1].startsWith("Z"),
			`Chromium ${pid} survived cancellation`,
		);
	} finally {
		controller.abort();
		await running.catch(() => {
			/* Teardown settles ownership before deleting fixtures. */
		});
		await fs.rm(dir, { recursive: true, force: true });
	}
});
