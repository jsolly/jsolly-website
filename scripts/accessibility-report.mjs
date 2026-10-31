// Report a full axe audit to shared-infra's scheduled-checks log group, whose
// metric filters alarm on `"level":"error"` lines and on a missing daily heartbeat.
// The a11y workflow runs this with OIDC credentials from
// arn:aws:iam::730335616323:role/github-actions-scheduled-checks, through the
// runner's preinstalled AWS CLI. Every run writes one heartbeat; violations are
// one error line per page, width and rule (at most MAX_VIOLATIONS, then one
// truncation line); an audit that failed without complete, readable results
// writes `check-failed` with a fixed message. It exits 1 whenever it reported an
// error line.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LOG_GROUP = "/shared-infra/scheduled-checks";
export const CHECK = "a11y";
export const MAX_VIOLATIONS = 50;
const MAX_FIELD = 500;
const JOB_RESULTS = new Set(["success", "failure", "cancelled", "skipped"]);
// C0 and C1 controls (CR and LF included), DEL and the Unicode line separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Matching control characters is the purpose.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu;

// Every string the payload carries: one line, at most MAX_FIELD characters.
// The lines are quoted into alert email and retained, and GitHub's secret
// masking does not apply to them.
const bounded = (value) => {
	const text = String(value ?? "")
		.replace(CONTROL, " ")
		.trim();
	return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;
};
const count = (value) =>
	Number.isSafeInteger(value) && value >= 0 ? value : 0;

// check-failed messages come only from this vocabulary. The audit's own error
// text (stack traces, URLs, browser output) stays in the run's artifact.
const failureMessage = (audit, jobResult) => {
	const result = JOB_RESULTS.has(jobResult) ? jobResult : "unknown";
	if (!audit)
		return `The audit job ended ${result} without accessibility results (setup, build or audit start failed).`;
	if (audit.invalid)
		return "The audit wrote unreadable accessibility results; see the run's accessibility-results artifact.";
	if (audit.error)
		return "The audit stopped before completing; see the run's accessibility-results artifact.";
	if (audit.results.length !== audit.expected)
		return `Incomplete accessibility audit: ${count(audit.results.length)}/${count(audit.expected)} page-viewports.`;
	if (result !== "success" && !audit.results.some((r) => r.violations.length))
		return `The audit job ended ${result} after a clean audit.`;
	return null;
};

// The parsed results file, null when absent, or { invalid: true } when it is not
// the shape check-accessibility.mjs writes, so a bad file still reports.
export function parseAudit(text) {
	if (text === null) return null;
	try {
		const audit = JSON.parse(text);
		if (
			Number.isSafeInteger(audit?.expected) &&
			(audit.error === null || typeof audit.error === "string") &&
			Array.isArray(audit.results) &&
			audit.results.every(
				(result) =>
					Array.isArray(result?.violations) &&
					result.violations.every((v) => typeof v?.id === "string"),
			)
		)
			return audit;
	} catch {
		// Reported below as unreadable results.
	}
	return { invalid: true };
}

// Pure: the log events for one run. `audit` is the parsed accessibility-results.json
// ({ expected, error, results }) or null when the audit job wrote none; `jobResult`
// is the audit job's result (success, failure, cancelled, skipped). The heartbeat
// is always the last event, whatever the outcome.
export function reportEvents({ run, audit, jobResult, synthetic = false }) {
	const common = {
		repo: run.repository.split("/")[1],
		check: CHECK,
		run_url: `${run.serverUrl}/${run.repository}/actions/runs/${run.runId}/attempts/${run.runAttempt}`,
		sha: run.sha,
	};
	const violations = [];
	for (const { path, width, violations: found } of audit?.invalid
		? []
		: (audit?.results ?? []))
		for (const { id, impact, help } of found)
			violations.push({
				level: "error",
				event: "a11y-violation",
				...common,
				page: path,
				width: count(width),
				rule: id,
				impact,
				help,
			});
	if (synthetic)
		violations.push({
			level: "error",
			event: "a11y-violation",
			...common,
			page: "/synthetic-alert-test/",
			width: 1280,
			rule: "synthetic-alert-test",
			impact: "minor",
			help: "Synthetic violation requested by workflow_dispatch to test alert delivery; not a real finding.",
		});
	const failure = failureMessage(audit, jobResult);
	const events = violations.slice(0, MAX_VIOLATIONS);
	if (violations.length > MAX_VIOLATIONS)
		events.push({
			level: "error",
			event: "violations-truncated",
			...common,
			omitted: violations.length - MAX_VIOLATIONS,
		});
	if (failure)
		events.push({
			level: "error",
			event: "check-failed",
			...common,
			message: failure,
		});
	events.push({
		level: "info",
		event: "heartbeat",
		...common,
		outcome: events.length ? "fail" : "pass",
		violations: violations.length,
	});
	return events.map((event) =>
		Object.fromEntries(
			Object.entries(event).map(([key, value]) => [
				key,
				typeof value === "number" ? value : bounded(value),
			]),
		),
	);
}

function aws(args) {
	const result = spawnSync("aws", [...args, "--output", "json"], {
		encoding: "utf8",
		env: { ...process.env, AWS_PAGER: "" },
		stdio: ["ignore", "pipe", "inherit"],
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`aws ${args.slice(0, 2).join(" ")} exited ${result.status}`,
		);
	return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function main(env) {
	for (const name of [
		"GITHUB_SERVER_URL",
		"GITHUB_REPOSITORY",
		"GITHUB_RUN_ID",
		"GITHUB_RUN_ATTEMPT",
		"GITHUB_SHA",
		"AUDIT_JOB_RESULT",
		"A11Y_RESULTS",
	])
		if (!env[name]) throw new Error(`${name} is required`);
	const run = {
		serverUrl: env.GITHUB_SERVER_URL,
		repository: env.GITHUB_REPOSITORY,
		runId: env.GITHUB_RUN_ID,
		runAttempt: env.GITHUB_RUN_ATTEMPT,
		sha: env.GITHUB_SHA,
	};
	const audit = parseAudit(
		existsSync(env.A11Y_RESULTS)
			? readFileSync(env.A11Y_RESULTS, "utf8")
			: null,
	);
	const events = reportEvents({
		run,
		audit,
		jobResult: env.AUDIT_JOB_RESULT,
		synthetic: env.A11Y_SYNTHETIC === "true",
	});
	const stream = `${events[0].repo}/${CHECK}/${run.runId}-${run.runAttempt}`;
	const timestamp = Date.now();
	const file = join(mkdtempSync(join(tmpdir(), "a11y-report-")), "events.json");
	writeFileSync(
		file,
		JSON.stringify(
			events.map((event) => ({ timestamp, message: JSON.stringify(event) })),
		),
	);
	aws([
		"logs",
		"create-log-stream",
		"--log-group-name",
		LOG_GROUP,
		"--log-stream-name",
		stream,
	]);
	const put = aws([
		"logs",
		"put-log-events",
		"--log-group-name",
		LOG_GROUP,
		"--log-stream-name",
		stream,
		"--log-events",
		`file://${file}`,
	]);
	if (put.rejectedLogEventsInfo)
		throw new Error(
			`CloudWatch Logs rejected events: ${JSON.stringify(put.rejectedLogEventsInfo)}`,
		);
	const errors = events.filter((event) => event.level === "error");
	console.log(
		`Reported ${events.length} events to ${LOG_GROUP}:${stream}; ${errors.length} error lines.`,
	);
	if (errors.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.env);
