import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { smokeEvents } from "../../monitoring/production-smoke-report.mjs";
import { callShape, eventsOf, fakeAwsCli, sentTo } from "./fake-aws-cli.mjs";

const SCRIPT = fileURLToPath(
	new URL("../../monitoring/production-smoke-report.mjs", import.meta.url),
);
const RELEASE = "e".repeat(40);
const run = {
	serverUrl: "https://github.com",
	repository: "jsolly/jsolly-website",
	repo: "jsolly-website",
	runId: "41244187263",
	runAttempt: "1",
	sha: "d".repeat(40),
};
// shared-infra's heartbeat filter matches repo and check literally.
const common = {
	repo: "jsolly-website",
	check: "production-smoke",
	run_url:
		"https://github.com/jsolly/jsolly-website/actions/runs/41244187263/attempts/1",
	sha: "d".repeat(40),
	release_sha: RELEASE,
};
const ended = (result) =>
	`The production smoke job ended ${result}. See the run and its production-smoke artifact for the failing step.`;
const UNKNOWN_RESULT = /Unknown smoke job result: neutral/u;
const MISSING_RESULT = /SMOKE_JOB_RESULT is required/u;
const REJECTED = /CloudWatch Logs rejected events/u;

it("a passing daily smoke writes only a passing heartbeat for the verified release", () => {
	assert.deepEqual(
		smokeEvents({ run, jobResult: "success", releaseSha: RELEASE }),
		[{ level: "info", event: "heartbeat", ...common, outcome: "pass" }],
	);
});

it("a failed daily smoke pages with one fixed check-failed line, then the heartbeat", () => {
	assert.deepEqual(
		smokeEvents({ run, jobResult: "failure", releaseSha: RELEASE }),
		[
			{
				level: "error",
				event: "check-failed",
				...common,
				message: ended("failure"),
			},
			{ level: "info", event: "heartbeat", ...common, outcome: "fail" },
		],
	);
});

it.each(["cancelled", "skipped"])(
	"a smoke job that ended %s still pages, naming the result",
	(result) => {
		assert.deepEqual(
			smokeEvents({ run, jobResult: result, releaseSha: RELEASE }),
			[
				{
					level: "error",
					event: "check-failed",
					...common,
					message: ended(result),
				},
				{ level: "info", event: "heartbeat", ...common, outcome: "fail" },
			],
		);
	},
);

it("a run that never resolved its release reports without a release_sha", () => {
	const { release_sha: _, ...withoutRelease } = common;
	assert.deepEqual(
		smokeEvents({ run, jobResult: "failure", releaseSha: "" }).at(-1),
		{ level: "info", event: "heartbeat", ...withoutRelease, outcome: "fail" },
	);
});

it("a release value that is not a full commit SHA is left out, not echoed", () => {
	for (const releaseSha of [
		"main",
		`${RELEASE}\n`,
		RELEASE.slice(1),
		"<img src=x>",
	])
		assert.deepEqual(
			smokeEvents({ run, jobResult: "failure", releaseSha }).map(
				({ release_sha }) => release_sha,
			),
			[undefined, undefined],
		);
});

it("refuses a job result GitHub never reports rather than guessing pass or fail", () => {
	assert.throws(
		() => smokeEvents({ run, jobResult: "neutral", releaseSha: RELEASE }),
		UNKNOWN_RESULT,
	);
});

function reporter(t) {
	const { run: runScript } = fakeAwsCli(t, "production-smoke");
	return (env, mode) =>
		runScript(
			SCRIPT,
			{
				GITHUB_SERVER_URL: run.serverUrl,
				GITHUB_REPOSITORY: run.repository,
				GITHUB_RUN_ID: run.runId,
				GITHUB_RUN_ATTEMPT: run.runAttempt,
				GITHUB_SHA: run.sha,
				SMOKE_RELEASE_SHA: RELEASE,
				...env,
			},
			mode,
		);
}
const SENT = sentTo("jsolly-website/production-smoke/41244187263-1");

it("writes the run's events to its own log stream and fails the run on a smoke failure", (t) => {
	const report = reporter(t);
	const failed = report({ SMOKE_JOB_RESULT: "failure" });
	assert.equal(failed.status, 1, failed.stderr);
	assert.deepEqual(callShape(failed.calls), SENT);
	assert.deepEqual(
		eventsOf(failed.calls).map(({ event }) => event),
		["check-failed", "heartbeat"],
	);
	assert.deepEqual(failed.leftovers, []);
	const passed = report({ SMOKE_JOB_RESULT: "success" });
	assert.equal(passed.status, 0, passed.stderr);
	assert.deepEqual(callShape(passed.calls), SENT);
	assert.deepEqual(eventsOf(passed.calls), [
		{ level: "info", event: "heartbeat", ...common, outcome: "pass" },
	]);
	assert.deepEqual(passed.leftovers, []);
});

it("fails without writing when the job result is missing, and when AWS fails or rejects events", (t) => {
	const report = reporter(t);
	const missing = report({ SMOKE_JOB_RESULT: "" });
	assert.notEqual(missing.status, 0);
	assert.match(missing.stderr, MISSING_RESULT);
	assert.deepEqual(missing.calls, []);
	const create = report({ SMOKE_JOB_RESULT: "success" }, "create-fails");
	assert.notEqual(create.status, 0);
	assert.deepEqual(
		create.calls.map(({ args }) => args[1]),
		["create-log-stream"],
	);
	assert.deepEqual(create.leftovers, []);
	const rejected = report({ SMOKE_JOB_RESULT: "success" }, "rejected");
	assert.notEqual(rejected.status, 0);
	assert.match(rejected.stderr, REJECTED);
});
