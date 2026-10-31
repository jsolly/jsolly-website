// Report a full axe audit to shared-infra's scheduled-checks log group through
// the shared writer (scripts/scheduled-check-report.mjs). Every run writes one
// heartbeat; violations are one error line per page, width and rule (at most
// MAX_VIOLATIONS, then one truncation line); a run without complete, readable
// results writes `check-failed` with a fixed message. It exits 1 whenever it
// reported an error line, and when the AWS CLI fails or CloudWatch rejects an event.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WIDTHS } from "./accessibility-pages.mjs";
import {
	boundedEvents,
	commonFields,
	runFromEnv,
	sendEvents,
} from "./scheduled-check-report.mjs";

const CHECK = "a11y";
const MAX_VIOLATIONS = 50;

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
	const common = commonFields(run, CHECK);
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
	return boundedEvents(events);
}

function main(env) {
	const run = runFromEnv(env, ["AUDIT_JOB_RESULT", "A11Y_RESULTS"]);
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
	// The run fails whenever it reported an error line.
	if (sendEvents({ run, check: CHECK, events })) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.env);
