// biome-ignore-all lint/suspicious/noMisplacedAssertion: This subprocess fixture verifies startup and cleanup receipts outside its passing test body.
import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { afterAll, beforeAll, it } from "vitest";
import { NODE_NETWORK_ERROR_CODE } from "../network/node/constants.js";

const { NETWORK_LIFECYCLE_CASE: scenario, NETWORK_LIFECYCLE_RECEIPT: receipt } =
	process.env;
assert.ok(receipt);
assert.ok(
	scenario === "clean" || scenario === "afterAll" || scenario === "cleanup",
);
const guard = globalThis.__jsollyOfflineNodeGuard;
assert.ok(guard);
const events: string[] = [];
let accepted = 0;
let lookups = 0;
const server = createServer((socket) => {
	accepted++;
	socket.end();
});
function deny(): void {
	assert.throws(
		() =>
			connect({
				host: "lifecycle-control.invalid",
				port: 1,
				lookup() {
					lookups++;
					throw new Error("Forbidden destination reached DNS");
				},
			}),
		{ code: NODE_NETWORK_ERROR_CODE },
	);
}

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return async () => {
		events.push("cleanup");
		if (scenario === "cleanup") deny();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		const denialCodes = guard.violations.map(({ error }) => {
			assert.ok("code" in error);
			return error.code;
		});
		assert.equal(accepted, 1);
		assert.equal(lookups, 0);
		assert.equal(server.listening, false);
		assert.deepEqual(
			denialCodes,
			scenario === "clean" ? [] : [NODE_NETWORK_ERROR_CODE],
		);
		writeFileSync(
			receipt,
			JSON.stringify({
				scenario,
				events,
				denialCodes,
				accepted,
				lookups,
				listening: server.listening,
			}),
		);
	};
});
afterAll(() => {
	events.push("afterAll");
	if (scenario === "afterAll") deny();
});
it("completes its body and all cleanup", async () => {
	events.push("body");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const socket = connect({ host: "127.0.0.1", port: address.port });
	await once(socket, "close");
});
