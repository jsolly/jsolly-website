import assert from "node:assert/strict";
import {
	PutLogEventsCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-cloudwatch-logs";
import { it } from "vitest";
import { CLIENT_ERROR_LOG } from "./client-error-constants.mjs";
import {
	clientErrorLogLine,
	createCloudWatchRecorder,
	productionClient,
} from "./client-error-sink.mjs";

const REPORT = {
	category: "recipe-update",
	page: "/recipes/",
	message: "A recipe app update failed.",
};
const PROVIDER_NOT_CALLED = /credentials provider not called by this test/u;
// A request that never settles, as a stalled connection would.
const NEVER_SETTLES = () =>
	// biome-ignore lint/suspicious/noEmptyBlockStatements: the executor deliberately never settles.
	new Promise(() => {});

it("writes the structured error shape shared-infra's enricher and metric filter read", () => {
	assert.deepEqual(JSON.parse(clientErrorLogLine(REPORT)), {
		level: "error",
		message: "Client error reported on /recipes/",
		context: { category: "recipe-update", page: "/recipes/" },
		error: { name: "recipe-update", message: "A recipe app update failed." },
	});
});

it("puts one event on the stack's log stream", async () => {
	const sent = [];
	const record = createCloudWatchRecorder({
		client: {
			send: (command) => {
				sent.push(command);
				return Promise.resolve({});
			},
		},
		now: () => 1793434246210,
	});
	await record(REPORT);
	assert.equal(sent.length, 1);
	assert.ok(sent[0] instanceof PutLogEventsCommand);
	assert.deepEqual(sent[0].input, {
		logGroupName: CLIENT_ERROR_LOG.logGroupName,
		logStreamName: CLIENT_ERROR_LOG.logStreamName,
		logEvents: [
			{ timestamp: 1793434246210, message: clientErrorLogLine(REPORT) },
		],
	});
});

it("surfaces a missing log group as the SDK's named error", async () => {
	const missing = new ResourceNotFoundException({
		message: "The specified log group does not exist.",
		$metadata: { httpStatusCode: 400 },
	});
	const record = createCloudWatchRecorder({
		client: { send: () => Promise.reject(missing) },
	});
	await assert.rejects(record(REPORT), { name: "ResourceNotFoundException" });
});

it("treats an event CloudWatch accepted but dropped as a failed write", async () => {
	const record = createCloudWatchRecorder({
		client: {
			send: () =>
				Promise.resolve({
					rejectedLogEventsInfo: { tooOldLogEventEndIndex: 0 },
				}),
		},
	});
	await assert.rejects(record(REPORT), { name: "ClientErrorEventRejected" });
});

it("fails and aborts a forward that outlives its deadline instead of waiting for the platform", {
	timeout: 5000,
}, async () => {
	let signal;
	const record = createCloudWatchRecorder({
		client: {
			send: (_command, options) => {
				signal = options.abortSignal;
				return NEVER_SETTLES();
			},
		},
		deadlineMs: 20,
	});
	await assert.rejects(record(REPORT), { name: "ClientErrorForwardTimeout" });
	assert.equal(signal.aborted, true);
});

it("federates into the stack's role and region, with one write attempt", async () => {
	const requested = [];
	const client = productionClient({
		credentialsProvider: (options) => {
			requested.push(options);
			return () =>
				Promise.reject(
					new Error("credentials provider not called by this test"),
				);
		},
	});
	assert.equal(requested.length, 1);
	assert.equal(requested[0].roleArn, CLIENT_ERROR_LOG.roleArn);
	assert.equal(requested[0].clientConfig.region, CLIENT_ERROR_LOG.region);
	assert.equal(requested[0].clientConfig.maxAttempts, 2);
	assert.deepEqual(requested[0].clientConfig.requestHandler, {
		connectionTimeout: 1000,
		requestTimeout: 2000,
		throwOnRequestTimeout: true,
	});
	const [region, attempts] = await Promise.all([
		client.config.region(),
		client.config.maxAttempts(),
	]);
	assert.equal(region, CLIENT_ERROR_LOG.region);
	assert.equal(attempts, 1);
	// The client resolves credentials through the injected provider, not the default chain.
	await assert.rejects(client.config.credentials(), PROVIDER_NOT_CALLED);
});
