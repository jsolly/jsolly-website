import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import {
	LOG_GROUP,
	MAX_VIOLATIONS,
	parseAudit,
	reportEvents,
} from "../accessibility-report.mjs";

const SCRIPT = fileURLToPath(
	new URL("../accessibility-report.mjs", import.meta.url),
);
const FIXTURE = fileURLToPath(
	new URL("../fixtures/accessibility-results.json", import.meta.url),
);
// biome-ignore lint/suspicious/noControlCharactersInRegex: The payload must carry none.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const UNKNOWN_RESULT = /^The audit job ended unknown without/u;
const UNREADABLE = /unreadable accessibility results/u;
const NO_RESULTS = /ended failure without accessibility results/u;
const CLEAN_FAILURE = /ended failure after a clean audit/u;
const fixture = () => JSON.parse(readFileSync(FIXTURE, "utf8"));
const run = {
	serverUrl: "https://github.com",
	repository: "jsolly/jsolly-website",
	runId: "123",
	runAttempt: "2",
	sha: "a".repeat(40),
};
const common = {
	repo: "jsolly-website",
	check: "a11y",
	run_url:
		"https://github.com/jsolly/jsolly-website/actions/runs/123/attempts/2",
	sha: "a".repeat(40),
};
const clean = (count) => ({
	expected: count,
	error: null,
	results: Array.from({ length: count }, (_, i) => ({
		path: `/p${i}/`,
		width: 390,
		violations: [],
		incomplete: [],
	})),
});

it("reports one error line per failing page, width and rule, then the heartbeat", () => {
	const events = reportEvents({
		run,
		audit: fixture(),
		jobResult: "failure",
	});
	assert.deepEqual(events, [
		{
			level: "error",
			event: "a11y-violation",
			...common,
			page: "/about/",
			width: 390,
			rule: "color-contrast",
			impact: "serious",
			help: "Elements must meet minimum color contrast ratio thresholds",
		},
		{
			level: "error",
			event: "a11y-violation",
			...common,
			page: "/blog/",
			width: 1280,
			rule: "image-alt",
			impact: "critical",
			help: "Images must have alternative text",
		},
		{
			level: "error",
			event: "a11y-violation",
			...common,
			page: "/blog/",
			width: 1280,
			rule: "link-name",
			impact: "serious",
			help: "Links must have discernible text",
		},
		{
			level: "info",
			event: "heartbeat",
			...common,
			outcome: "fail",
			violations: 3,
		},
	]);
	// No page markup, selectors or review-only findings leave the runner.
	assert.ok(!JSON.stringify(events).includes("Secret page markup"));
	assert.ok(!JSON.stringify(events).includes("contact-me-heading"));
});

it("a clean, complete audit writes only a passing heartbeat", () => {
	assert.deepEqual(
		reportEvents({ run, audit: clean(4), jobResult: "success" }),
		[
			{
				level: "info",
				event: "heartbeat",
				...common,
				outcome: "pass",
				violations: 0,
			},
		],
	);
});

it("caps violation lines and reports the omitted count", () => {
	const audit = clean(2);
	audit.results[0].violations = Array.from(
		{ length: MAX_VIOLATIONS + 10 },
		(_, i) => ({ id: `rule-${i}`, impact: "minor", help: "help", nodes: [] }),
	);
	const events = reportEvents({ run, audit, jobResult: "failure" });
	assert.equal(
		events.filter((e) => e.event === "a11y-violation").length,
		MAX_VIOLATIONS,
	);
	assert.deepEqual(events.at(-2), {
		level: "error",
		event: "violations-truncated",
		...common,
		omitted: 10,
	});
	assert.equal(events.at(-1).violations, MAX_VIOLATIONS + 10);
	assert.equal(events.length, MAX_VIOLATIONS + 2);
});

it("reports a crashed, incomplete or missing audit as check-failed", () => {
	const failureMessage = (reported) =>
		reported.find((e) => e.event === "check-failed")?.message;
	const crashed = fixture();
	crashed.error =
		"Hydration failed\n    at http://127.0.0.1:1/x.js TOKEN=secret";
	crashed.results = crashed.results.slice(0, 3);
	const events = reportEvents({ run, audit: crashed, jobResult: "failure" });
	// Partial findings still alert; the audit's own error text never leaves the runner.
	assert.equal(events.filter((e) => e.event === "a11y-violation").length, 3);
	assert.equal(
		failureMessage(events),
		"The audit stopped before completing; see the run's accessibility-results artifact.",
	);
	assert.ok(!JSON.stringify(events).includes("secret"));
	assert.equal(events.at(-1).event, "heartbeat");
	assert.equal(events.at(-1).outcome, "fail");

	const incomplete = clean(4);
	incomplete.results.pop();
	assert.equal(
		failureMessage(
			reportEvents({ run, audit: incomplete, jobResult: "failure" }),
		),
		"Incomplete accessibility audit: 3/4 page-viewports.",
	);
	const missing = reportEvents({ run, audit: null, jobResult: "failure" });
	assert.match(failureMessage(missing), NO_RESULTS);
	assert.deepEqual(missing.at(-1), {
		level: "info",
		event: "heartbeat",
		...common,
		outcome: "fail",
		violations: 0,
	});
	assert.match(
		failureMessage(
			reportEvents({ run, audit: clean(2), jobResult: "failure" }),
		),
		CLEAN_FAILURE,
	);
	// An unexpected job result never reaches the message verbatim.
	assert.match(
		failureMessage(
			reportEvents({ run, audit: null, jobResult: "x\nInjected: header" }),
		),
		UNKNOWN_RESULT,
	);
});

it("reports unreadable results as check-failed and still sends the heartbeat", () => {
	assert.equal(parseAudit(null), null);
	assert.deepEqual(parseAudit(readFileSync(FIXTURE, "utf8")), fixture());
	for (const text of [
		"{",
		"[]",
		'{"expected":2,"error":null}',
		'{"expected":1,"error":null,"results":[{"violations":[null]}]}',
		'{"expected":1,"error":{"stack":"x"},"results":[]}',
	]) {
		const audit = parseAudit(text);
		assert.deepEqual(audit, { invalid: true }, text);
		const events = reportEvents({ run, audit, jobResult: "failure" });
		assert.deepEqual(
			events.map((e) => e.event),
			["check-failed", "heartbeat"],
		);
		assert.match(events[0].message, UNREADABLE);
	}
});

it("sends only single-line, bounded strings and no request ids", () => {
	const audit = clean(1);
	audit.results[0].path = `/a\r\nb/${"p".repeat(900)}`;
	audit.results[0].width = "390\n";
	audit.results[0].violations = [
		{
			id: "rule\u2028x",
			impact: "serious\u0007",
			help: `Help\r\n${"h".repeat(900)}`,
			requestId: "abc",
			nodes: [],
		},
	];
	const events = reportEvents({
		run: { ...run, sha: `${"b".repeat(40)}\n` },
		audit,
		jobResult: "failure",
	});
	assert.ok(events.every((event) => !("requestId" in event)));
	const values = events.flatMap((event) => Object.values(event));
	const strings = values.filter((value) => typeof value === "string");
	assert.deepEqual(
		strings.filter((value) => value.length > 500 || CONTROL.test(value)),
		[],
	);
	assert.ok(
		values
			.filter((value) => typeof value !== "string")
			.every((value) => Number.isSafeInteger(value) && value >= 0),
	);
	const [violation] = events;
	assert.equal(violation.page.length, 500);
	assert.ok(violation.page.startsWith("/a b/p"));
	assert.equal(violation.width, 0);
	assert.equal(violation.rule, "rule x");
	assert.equal(violation.impact, "serious");
	assert.equal(violation.sha, "b".repeat(40));
});

it("adds one synthetic violation only when requested", () => {
	const events = reportEvents({
		run,
		audit: clean(2),
		jobResult: "success",
		synthetic: true,
	});
	assert.deepEqual(
		events.map((e) => [e.level, e.event, e.rule]),
		[
			["error", "a11y-violation", "synthetic-alert-test"],
			["info", "heartbeat", undefined],
		],
	);
	assert.equal(events.at(-1).outcome, "fail");
});

it("writes the events to the run's own log stream and exits 1 on error lines", (t) => {
	const root = mkdtempSync(join(tmpdir(), "a11y-report-test-"));
	t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "bin"));
	const calls = join(root, "calls.jsonl");
	// A stand-in aws CLI: records arguments and the events file, never reaches AWS.
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
if (args[1] === "put-log-events") console.log("{}");
`,
	);
	chmodSync(join(root, "bin", "aws"), 0o755);
	const cli = (results, jobResult, synthetic) =>
		spawnSync(process.execPath, [SCRIPT], {
			encoding: "utf8",
			env: {
				PATH: `${join(root, "bin")}:${process.env.PATH}`,
				GITHUB_SERVER_URL: run.serverUrl,
				GITHUB_REPOSITORY: run.repository,
				GITHUB_RUN_ID: run.runId,
				GITHUB_RUN_ATTEMPT: run.runAttempt,
				GITHUB_SHA: run.sha,
				AUDIT_JOB_RESULT: jobResult,
				A11Y_RESULTS: results,
				A11Y_SYNTHETIC: synthetic,
			},
		});
	const failed = cli(FIXTURE, "failure", "false");
	assert.equal(failed.status, 1, failed.stderr);
	const [create, put] = readFileSync(calls, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const stream = ["--log-stream-name", "jsolly-website/a11y/123-2"];
	assert.deepEqual(create.args, [
		"logs",
		"create-log-stream",
		"--log-group-name",
		LOG_GROUP,
		...stream,
		"--output",
		"json",
	]);
	assert.deepEqual(put.args.slice(0, 6), [
		"logs",
		"put-log-events",
		"--log-group-name",
		LOG_GROUP,
		...stream,
	]);
	assert.equal(put.pager, "");
	assert.deepEqual(
		put.events.map(({ message }) => JSON.parse(message)),
		reportEvents({ run, audit: fixture(), jobResult: "failure" }),
	);
	assert.ok(
		put.events.every(({ timestamp }) => timestamp === put.events[0].timestamp),
	);

	const cleanFile = join(root, "clean.json");
	writeFileSync(cleanFile, JSON.stringify(clean(2)));
	rmSync(calls);
	const passing = cli(cleanFile, "success", "false");
	assert.equal(passing.status, 0, passing.stderr);
	assert.equal(cli(cleanFile, "success", "true").status, 1);
});
