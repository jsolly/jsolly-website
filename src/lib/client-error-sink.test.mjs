import assert from "node:assert/strict";
import {
	PutLogEventsCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-cloudwatch-logs";
import { it, vi } from "vitest";
import { CLIENT_ERROR_LOG } from "./client-error-constants.mjs";
import {
	clientErrorLogLine,
	createCloudWatchRecorder,
	productionClient,
} from "./client-error-sink.mjs";

const REPORT = {
	level: "error",
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

it("writes the forwarding probe as an info line the error metric filter cannot count", () => {
	// The stack's metric filter is { $.level = "error" } (scripts/unit/client-errors-stack.test.mjs).
	assert.deepEqual(
		JSON.parse(
			clientErrorLogLine({
				level: "info",
				category: "forwarding-probe",
				page: "/",
				message: "Production smoke verified client-error forwarding.",
			}),
		),
		{
			level: "info",
			message: "Production smoke verified client-error forwarding.",
			context: { category: "forwarding-probe", page: "/" },
		},
	);
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

// The repository sets no default test timeout, so this bound turns a broken
// deadline into a failure instead of a hung run; it sits far above the 20 ms deadline.
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

it("arms no deadline timer when the write throws before returning a promise", async () => {
	vi.useFakeTimers();
	try {
		const record = createCloudWatchRecorder({
			client: {
				send: () => {
					throw new TypeError("send threw synchronously");
				},
			},
		});
		await assert.rejects(record(REPORT), { name: "TypeError" });
		assert.equal(vi.getTimerCount(), 0);
	} finally {
		vi.useRealTimers();
	}
});

it("federates into the stack's role and region and bounds the credential exchange and the single write attempt", async () => {
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
	// The write's own per-attempt bounds, read from the SDK's resolved handler config.
	const writeHandler = await client.config.requestHandler.configProvider;
	assert.equal(writeHandler.connectionTimeout, 1000);
	assert.equal(writeHandler.requestTimeout, 2000);
	assert.equal(writeHandler.throwOnRequestTimeout, true);
	// The client resolves credentials through the injected provider, not the default chain.
	await assert.rejects(client.config.credentials(), PROVIDER_NOT_CALLED);
});
