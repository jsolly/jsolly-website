// Report a full axe audit to shared-infra's scheduled-checks log group, whose
// metric filters alarm on `"level":"error"` lines and on a missing daily heartbeat.
// The a11y workflow runs this with OIDC credentials from
// arn:aws:iam::730335616323:role/github-actions-scheduled-checks, through the
// runner's preinstalled AWS CLI. Every run writes one heartbeat; violations are
// one error line per page, width and rule (at most MAX_VIOLATIONS, then one
// truncation line); a run without complete, readable results writes
// `check-failed` with a fixed message. It exits 1 whenever it reported an error
// line, and when the AWS CLI fails or CloudWatch rejects an event.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIDTHS } from "./accessibility-pages.mjs";

const LOG_GROUP = "/shared-infra/scheduled-checks";
const CHECK = "a11y";
const MAX_VIOLATIONS = 50;
const MAX_FIELD = 500;
// Control (Cc: C0, C1, DEL, CR, LF) and format (Cf: bidi overrides, zero-width)
// characters, and the Unicode line and paragraph separators.
const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]+/gu;

// Every string the payload carries: one line, at most MAX_FIELD characters.
// The lines are quoted into alert email and retained, and GitHub's secret
// masking does not apply to them.
// Lone surrogates become U+FFFD, and the cut never splits a surrogate pair, so
// every value stays well-formed UTF-16 for downstream serializers.
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;
const bounded = (value) => {
	const text = String(value ?? "")
		.toWellFormed()
		.replace(UNSAFE, " ")
		.trim();
	if (text.length <= MAX_FIELD) return text;
	const cut = text.slice(0, MAX_FIELD - 1);
	return `${HIGH_SURROGATE.test(cut) ? cut.slice(0, -1) : cut}…`;
};

const isAudit = (audit) =>
	Number.isSafeInteger(audit?.expected) &&
	(audit.error === null || typeof audit.error === "string") &&
	Array.isArray(audit.results) &&
	audit.results.every(
		(result) =>
			typeof result?.path === "string" &&
			WIDTHS.includes(result.width) &&
			Array.isArray(result.violations) &&
			result.violations.every((v) => typeof v?.id === "string"),
	);

// The check-failed message for readable results, or null when they are complete.
function auditFailure({ error, expected, results }, jobResult) {
	if (error)
		return "The audit stopped before completing; see the run's accessibility-results artifact.";
	if (results.length !== expected)
		return `Incomplete accessibility audit: ${results.length}/${expected} page-viewports.`;
	if (jobResult !== "success" && !results.some((r) => r.violations.length))
		return `The audit job ended ${jobResult} after a clean audit.`;
	return null;
}

// Pure: what one run reports, from the accessibility-results.json text the audit
// job handed over (null when none arrived), that job's result and the ID of the
// artifact it published (empty when it published none). `failure` is the
// check-failed message, from this fixed vocabulary only: the audit's own error
// text (stack traces, URLs, browser output) stays in the run's artifact.
export function auditOutcome(text, jobResult, artifactId) {
	if (text === null)
		return {
			results: [],
			failure: artifactId
				? `The audit job ended ${jobResult} and published its accessibility results, but they did not reach the reporter (artifact handoff failed).`
				: `The audit job ended ${jobResult} without accessibility results (setup, build or audit start failed).`,
		};
	let audit;
	try {
		audit = JSON.parse(text);
	} catch {
		audit = null;
	}
	if (!isAudit(audit))
		return {
			results: [],
			failure:
				"The audit wrote unreadable accessibility results; see the run's accessibility-results artifact.",
		};
	return { results: audit.results, failure: auditFailure(audit, jobResult) };
}

// Pure: the log events for one run, from auditOutcome. The heartbeat is always
// the last event, whatever the outcome.
export function reportEvents({ run, results, failure, synthetic = false }) {
	const common = {
		repo: run.repo,
		check: CHECK,
		run_url: `${run.serverUrl}/${run.repository}/actions/runs/${run.runId}/attempts/${run.runAttempt}`,
		sha: run.sha,
	};
	const violations = [];
	for (const { path, width, violations: found } of results)
		for (const { id, impact, help } of found)
			violations.push({
				level: "error",
				event: "a11y-violation",
				...common,
				page: path,
				width,
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
		repo: env.GITHUB_REPOSITORY.split("/")[1],
		runId: env.GITHUB_RUN_ID,
		runAttempt: env.GITHUB_RUN_ATTEMPT,
		sha: env.GITHUB_SHA,
	};
	const events = reportEvents({
		run,
		...auditOutcome(
			existsSync(env.A11Y_RESULTS)
				? readFileSync(env.A11Y_RESULTS, "utf8")
				: null,
			env.AUDIT_JOB_RESULT,
			env.A11Y_ARTIFACT_ID,
		),
		synthetic: env.A11Y_SYNTHETIC === "true",
	});
	const stream = `${run.repo}/${CHECK}/${run.runId}-${run.runAttempt}`;
	const timestamp = Date.now();
	const dir = mkdtempSync(join(tmpdir(), "a11y-report-"));
	let put;
	try {
		const file = join(dir, "events.json");
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
		put = aws([
			"logs",
			"put-log-events",
			"--log-group-name",
			LOG_GROUP,
			"--log-stream-name",
			stream,
			"--log-events",
			`file://${file}`,
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
