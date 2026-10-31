import {
	CloudWatchLogsClient,
	PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { CLIENT_ERROR_LOG } from "./client-error-constants.mjs";

// Per-attempt limits for both the STS credential exchange and the write. The Logs
// write gets one attempt: PutLogEvents is not idempotent, so a retry after a slow
// but successful write would count one report twice toward the alarm.
const REQUEST_HANDLER = Object.freeze({
	connectionTimeout: 1000,
	requestTimeout: 2000,
	throwOnRequestTimeout: true,
});
// The whole forward, credentials included, ends before the function's 10 s limit,
// so a stall becomes a logged 502 rather than a killed invocation.
const FORWARD_DEADLINE_MS = 8000;

/**
 * One structured error line in the shape shared-infra's enricher reads:
 * `message` plus top-level `error: { name, message }`. Only validated fields
 * (a fixed category, its fixed text and a published route) reach it.
 */
export function clientErrorLogLine({ category, page, message }) {
	return JSON.stringify({
		level: "error",
		message: `Client error reported on ${page}`,
		context: { category, page },
		error: { name: category, message },
	});
}

// Rejects at the deadline and aborts the in-flight request, so a late write
// cannot land after the handler has already answered 502.
function withDeadline(start, ms) {
	const controller = new AbortController();
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => {
			const late = new Error(`Client-error forward exceeded ${ms} ms`);
			late.name = "ClientErrorForwardTimeout";
			controller.abort(late);
			reject(late);
		}, ms);
	});
	return Promise.race([start(controller.signal), deadline]).finally(() =>
		clearTimeout(timer),
	);
}

export function createCloudWatchRecorder({
	client,
	now = Date.now,
	deadlineMs = FORWARD_DEADLINE_MS,
}) {
	return async (report) => {
		const result = await withDeadline(
			(abortSignal) =>
				client.send(
					new PutLogEventsCommand({
						logGroupName: CLIENT_ERROR_LOG.logGroupName,
						logStreamName: CLIENT_ERROR_LOG.logStreamName,
						logEvents: [
							{ timestamp: now(), message: clientErrorLogLine(report) },
						],
					}),
					{ abortSignal },
				),
			deadlineMs,
		);
		// CloudWatch can accept the call yet drop the event (for example a timestamp
		// outside its window); that is a failed write, not a recorded report.
		if (result?.rejectedLogEventsInfo) {
			const rejected = new Error("CloudWatch rejected the client-error event");
			rejected.name = "ClientErrorEventRejected";
			throw rejected;
		}
	};
}

/** Vercel production OIDC federates into the stack's write-only role. */
export function productionClient({
	credentialsProvider = awsCredentialsProvider,
} = {}) {
	return new CloudWatchLogsClient({
		region: CLIENT_ERROR_LOG.region,
		maxAttempts: 1,
		requestHandler: REQUEST_HANDLER,
		credentials: credentialsProvider({
			roleArn: CLIENT_ERROR_LOG.roleArn,
			clientConfig: {
				region: CLIENT_ERROR_LOG.region,
				maxAttempts: 2,
				requestHandler: REQUEST_HANDLER,
			},
		}),
	});
}
