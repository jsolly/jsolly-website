import {
	CloudWatchLogsClient,
	PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

// Fixed by config/aws/client-errors/template.json; tests pin the two together.
export const CLIENT_ERROR_LOG = Object.freeze({
	region: "us-east-1",
	roleArn: "arn:aws:iam::730335616323:role/jsolly-website-client-errors",
	logGroupName: "/jsolly-website/client-errors",
	logStreamName: "vercel",
});

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

export function createCloudWatchRecorder({ client, now = Date.now }) {
	return async (report) => {
		await client.send(
			new PutLogEventsCommand({
				logGroupName: CLIENT_ERROR_LOG.logGroupName,
				logStreamName: CLIENT_ERROR_LOG.logStreamName,
				logEvents: [{ timestamp: now(), message: clientErrorLogLine(report) }],
			}),
		);
	};
}

/** Vercel production OIDC federates into the stack's write-only role. */
export function productionRecorder() {
	return createCloudWatchRecorder({
		client: new CloudWatchLogsClient({
			region: CLIENT_ERROR_LOG.region,
			credentials: awsCredentialsProvider({
				roleArn: CLIENT_ERROR_LOG.roleArn,
				clientConfig: { region: CLIENT_ERROR_LOG.region },
			}),
		}),
	});
}
