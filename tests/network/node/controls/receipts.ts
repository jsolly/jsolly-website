// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone native verification receipts are checked outside a test framework.
import assert from "node:assert/strict";
import { NODE_NETWORK_ERROR_CODE } from "../constants.ts";

type Receipt = Record<string, unknown>;

function isReceipt(value: unknown): value is Receipt {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Require actual child completion, not merely a nonzero failure status. */
export function requireControlReceipt(
	stdout: string,
	scenario: string,
	pid: number,
	denied: boolean,
): void {
	const records = stdout
		.trim()
		.split("\n")
		.map((line) => {
			const value: unknown = JSON.parse(line);
			assert.ok(isReceipt(value));
			return value;
		});
	const { length } = records;
	assert.equal(length, 3);
	const [started, closed, verified] = records;
	assert.ok(started && closed && verified);
	assert.deepEqual(
		records.map(({ event }) => event),
		["started", "closed", "verified"],
	);
	for (const record of records) {
		const { scenario: actualScenario, pid: actualPid, port } = record;
		const { port: startedPort }: { port?: unknown } = started;
		assert.equal(port, startedPort);
		assert.equal(actualScenario, scenario);
		assert.equal(actualPid, pid);
		assert.ok(typeof port === "number" && Number.isInteger(port) && port > 0);
	}
	const { denialCodes } = verified;
	assert.deepEqual(denialCodes, denied ? [NODE_NETWORK_ERROR_CODE] : []);
	const { listening } = closed;
	assert.equal(listening, false);
}
