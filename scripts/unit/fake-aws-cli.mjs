// A stand-in `aws` for the scheduled-check reporters' CLI tests: it records each
// call and the events file, and fails on request (AWS_STUB_MODE), never reaching
// AWS. The reporter's TMPDIR is the fixture root, so `leftovers` lists any temp
// directory a run left behind.
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOG_GROUP = ["--log-group-name", "/shared-infra/scheduled-checks"];

/** The shape every successful report's two AWS calls must have. */
export const callShape = (calls) => ({
	commands: calls.map(({ args }) => args.slice(0, 6)),
	createTail: calls[0]?.args.slice(6),
	pager: calls[1]?.pager,
	oneTimestamp: calls[1]?.events.every(
		({ timestamp }) => timestamp === calls[1].events[0].timestamp,
	),
});

export const sentTo = (stream) => ({
	commands: [
		["logs", "create-log-stream", ...LOG_GROUP, "--log-stream-name", stream],
		["logs", "put-log-events", ...LOG_GROUP, "--log-stream-name", stream],
	],
	createTail: ["--output", "json"],
	pager: "",
	oneTimestamp: true,
});

export const eventsOf = (calls) =>
	calls[1].events.map(({ message }) => JSON.parse(message));

/** A fresh fixture; `run` executes `script` with the stub first on PATH. */
export function fakeAwsCli(t, check) {
	const root = mkdtempSync(join(tmpdir(), `${check}-report-test-`));
	t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "bin"));
	const calls = join(root, "calls.jsonl");
	writeFileSync(
		join(root, "bin", "aws"),
		`#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const file = args.find((arg) => arg.startsWith("file://"));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({
  args, pager: process.env.AWS_PAGER,
  events: file ? JSON.parse(fs.readFileSync(file.slice(7), "utf8")) : null,
}) + "\\n");
const mode = process.env.AWS_STUB_MODE;
if (args[1] === "create-log-stream" && mode === "create-fails") process.exit(255);
if (args[1] === "put-log-events")
  console.log(mode === "rejected" ? '{"rejectedLogEventsInfo":{"tooOldLogEventEndIndex":0}}' : "{}");
`,
	);
	chmodSync(join(root, "bin", "aws"), 0o755);
	const file = (name, text) => {
		writeFileSync(join(root, name), text);
		return join(root, name);
	};
	const run = (script, env, mode = "") => {
		rmSync(calls, { force: true });
		const child = spawnSync(process.execPath, [script], {
			encoding: "utf8",
			env: {
				PATH: `${join(root, "bin")}:${process.env.PATH}`,
				TMPDIR: root,
				AWS_STUB_MODE: mode,
				...env,
			},
		});
		return {
			status: child.status,
			stdout: child.stdout,
			stderr: child.stderr,
			calls: existsSync(calls)
				? readFileSync(calls, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line))
				: [],
			leftovers: readdirSync(root).filter((name) =>
				name.startsWith(`${check}-report-`),
			),
		};
	};
	return { root, file, run };
}
