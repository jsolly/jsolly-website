import {
	CloudWatchLogsClient,
	PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { CLIENT_ERROR_LOG } from "./client-error-log.mjs";

// The browser gives up after 5 s, so a stalled AWS call fails fast and reaches
// the handler's logged 502 instead of holding the function until it is killed.
const AWS_CALL_LIMITS = Object.freeze({
	maxAttempts: 2,
	requestHandler: {
		connectionTimeout: 1000,
		requestTimeout: 2000,
		throwOnRequestTimeout: true,
	},
});

/**
 * One structured line in the shape shared-infra's enricher reads: `message` plus
 * top-level `error: { name, message }` for an error report. Only validated fields
 * (a fixed category, its fixed text and a published route) reach it.
 */
export function clientErrorLogLine({ level, category, page, message }) {
	if (level === "error")
		return JSON.stringify({
			level,
			message: `Client error reported on ${page}`,
			context: { category, page },
			error: { name: category, message },
		});
	return JSON.stringify({ level, message, context: { category, page } });
}

export function createCloudWatchRecorder({ client, now = Date.now }) {
	return async (report) => {
		const result = await client.send(
			new PutLogEventsCommand({
				logGroupName: CLIENT_ERROR_LOG.logGroupName,
				logStreamName: CLIENT_ERROR_LOG.logStreamName,
				logEvents: [{ timestamp: now(), message: clientErrorLogLine(report) }],
			}),
		);
		// CloudWatch can accept the call yet drop the event (for example a timestamp
		// outside its window); that is a failed write, not a recorded report.
		if (result?.rejectedLogEventsInfo || result?.rejectedEntityInfo) {
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
		...AWS_CALL_LIMITS,
		credentials: credentialsProvider({
			roleArn: CLIENT_ERROR_LOG.roleArn,
			clientConfig: { region: CLIENT_ERROR_LOG.region, ...AWS_CALL_LIMITS },
		}),
	});
}

export function productionRecorder() {
	return createCloudWatchRecorder({ client: productionClient() });
}
