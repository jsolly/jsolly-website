import assert from "node:assert/strict";
import { PutLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { it } from "vitest";
import {
	CLIENT_ERROR_LOG,
	clientErrorLogLine,
	createCloudWatchRecorder,
} from "./client-error-sink.mjs";

const NOT_FOUND = /ResourceNotFoundException/u;
const REPORT = {
	category: "recipe-update",
	page: "/recipes/",
	message: "A recipe app update failed.",
};

it("writes the structured error shape shared-infra's enricher and metric filter read", () => {
	assert.deepEqual(JSON.parse(clientErrorLogLine(REPORT)), {
		level: "error",
		message: "Client error reported on /recipes/",
		context: { category: "recipe-update", page: "/recipes/" },
		error: { name: "recipe-update", message: "A recipe app update failed." },
	});
});

it("puts one event on the stack's log stream and surfaces a CloudWatch failure", async () => {
	const sent = [];
	const record = createCloudWatchRecorder({
		client: { send: async (command) => sent.push(command) },
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

	const failing = createCloudWatchRecorder({
		client: {
			send: () => Promise.reject(new Error("ResourceNotFoundException")),
		},
	});
	await assert.rejects(failing(REPORT), NOT_FOUND);
});
