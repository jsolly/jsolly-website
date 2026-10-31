// The writer every check shares for jsolly/shared-infra's scheduled-checks
// contract (docs/shared-infra.md): one JSON object per log event in
// /shared-infra/scheduled-checks, stream `<repo>/<check>/<run id>-<attempt>`.
// shared-infra alarms on `"level":"error"` lines and, per check, on a missing
// heartbeat. A reporting job runs this with OIDC credentials from
// arn:aws:iam::730335616323:role/github-actions-scheduled-checks, through the
// runner's preinstalled AWS CLI, and installs no dependencies alongside the token.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOG_GROUP = "/shared-infra/scheduled-checks";
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

/** The fields every event of one run carries; the heartbeat filter matches repo and check. */
export function commonFields(run, check) {
	return {
		repo: run.repo,
		check,
		run_url: `${run.serverUrl}/${run.repository}/actions/runs/${run.runId}/attempts/${run.runAttempt}`,
		sha: run.sha,
	};
}

/** Numbers pass through; every other value becomes one bounded line. */
export function boundedEvents(events) {
	return events.map((event) =>
		Object.fromEntries(
			Object.entries(event).map(([key, value]) => [
				key,
				typeof value === "number" ? value : bounded(value),
			]),
		),
	);
}

/** The run's identity from GitHub's environment, after the check's own required names. */
export function runFromEnv(env, required = []) {
	for (const name of [
		"GITHUB_SERVER_URL",
		"GITHUB_REPOSITORY",
		"GITHUB_RUN_ID",
		"GITHUB_RUN_ATTEMPT",
		"GITHUB_SHA",
		...required,
	])
		if (!env[name]) throw new Error(`${name} is required`);
	return {
		serverUrl: env.GITHUB_SERVER_URL,
		repository: env.GITHUB_REPOSITORY,
		repo: env.GITHUB_REPOSITORY.split("/")[1],
		runId: env.GITHUB_RUN_ID,
		runAttempt: env.GITHUB_RUN_ATTEMPT,
		sha: env.GITHUB_SHA,
	};
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

/**
 * Writes the run's events to its own stream, all with one timestamp. Throws when
 * the AWS CLI fails or CloudWatch rejects an event, and sets exit code 1 when
 * the run reported an error line.
 */
export function sendEvents({ run, check, events }) {
	const stream = `${run.repo}/${check}/${run.runId}-${run.runAttempt}`;
	const timestamp = Date.now();
	const dir = mkdtempSync(join(tmpdir(), `${check}-report-`));
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
