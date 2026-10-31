// Report a scheduled or manual Production smoke run to shared-infra's
// scheduled-checks log group through the shared writer
// (scripts/scheduled-check-report.mjs). A failed run writes one `check-failed`
// error line, which pages through the shared error alarm; every run writes one
// heartbeat last, whose absence for about 30 hours pages through the check's own
// alarm (docs/shared-infra.md, Coverage). It exits 1 when it reported a failure,
// and when the AWS CLI fails or CloudWatch rejects an event.
import { fileURLToPath } from "node:url";
import {
	boundedEvents,
	commonFields,
	runFromEnv,
	sendEvents,
} from "./scheduled-check-report.mjs";

const CHECK = "production-smoke";
const JOB_RESULTS = ["success", "failure", "cancelled", "skipped"];
const RELEASE_SHA = /^[0-9a-f]{40}$/u;

// Pure: the events for one run, from the smoke job's result and the release it
// verified (empty when the job failed before resolving one). The heartbeat is
// always last; the message comes from this fixed text only, never from the run's
// output, which stays in its production-smoke artifact.
export function smokeEvents({ run, jobResult, releaseSha }) {
	if (!JOB_RESULTS.includes(jobResult))
		throw new Error(`Unknown smoke job result: ${jobResult}`);
	const common = {
		...commonFields(run, CHECK),
		...(RELEASE_SHA.test(releaseSha) ? { release_sha: releaseSha } : {}),
	};
	const passed = jobResult === "success";
	return boundedEvents([
		...(passed
			? []
			: [
					{
						level: "error",
						event: "check-failed",
						...common,
						message: `The production smoke job ended ${jobResult}. See the run and its production-smoke artifact for the failing step.`,
					},
				]),
		{
			level: "info",
			event: "heartbeat",
			...common,
			outcome: passed ? "pass" : "fail",
		},
	]);
}

function main(env) {
	const run = runFromEnv(env, ["SMOKE_JOB_RESULT"]);
	const events = smokeEvents({
		run,
		jobResult: env.SMOKE_JOB_RESULT,
		releaseSha: env.SMOKE_RELEASE_SHA ?? "",
	});
	// A reported smoke failure fails this job; the workflow's report job is
	// continue-on-error, so only the smoke job decides the run's conclusion.
	if (sendEvents({ run, check: CHECK, events })) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.env);
