import assert from "node:assert/strict";
import { it } from "vitest";
import { createClientErrorHandler } from "./client-error-server.mjs";

const ORIGIN = "https://www.jsolly.com";
const REPORT = { category: "recipe-print", page: "/recipes/meals/" };
const HEADERS = { Origin: ORIGIN, "Content-Type": "application/json" };
const CREDENTIAL_DETAIL = /secret credential detail/u;

function fixture({ record } = {}) {
	const logs = [];
	const failures = [];
	return {
		logs,
		failures,
		handle: createClientErrorHandler({
			paths: new Set(["/", "/recipes/meals/", "/privacy/"]),
			record: record ?? (async (report) => logs.push(report)),
			logFailure: (value) => failures.push(value),
		}),
	};
}
const request = (body = JSON.stringify(REPORT), headers = HEADERS) =>
	new Request(`${ORIGIN}/api/client-error/`, { method: "POST", headers, body });

it("accepts a fixed category on a published path and records only the allowed fields", async () => {
	const { handle, logs, failures } = fixture();
	const response = await handle(request());
	assert.equal(response.status, 204);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.deepEqual(logs, [
		{
			category: "recipe-print",
			page: "/recipes/meals/",
			message: "Recipe printing failed.",
		},
	]);
	assert.deepEqual(failures, []);
	assert.equal(await response.text(), "");
});

it("answers 502 and logs the validated report with the error's name and status but not its message", async () => {
	const failure = new Error("secret credential detail");
	failure.name = "AccessDeniedException";
	failure.$metadata = { httpStatusCode: 400 };
	const { handle, failures } = fixture({
		record: () => Promise.reject(failure),
	});
	const response = await handle(request());
	assert.equal(response.status, 502);
	assert.equal(await response.text(), "");
	assert.deepEqual(failures.map(JSON.parse), [
		{
			event: "client-error-forward-failed",
			category: "recipe-print",
			page: "/recipes/meals/",
			message: "Recipe printing failed.",
			error: "AccessDeniedException",
			status: 400,
		},
	]);
	assert.doesNotMatch(failures.join(""), CREDENTIAL_DETAIL);
});

it("logs a transport failure's code, since its name alone is the generic Error", async () => {
	const reset = Object.assign(new Error("socket hang up"), {
		code: "ECONNRESET",
	});
	const { handle, failures } = fixture({ record: () => Promise.reject(reset) });
	assert.equal((await handle(request())).status, 502);
	const [failure] = failures.map(JSON.parse);
	assert.equal(failure.error, "Error");
	assert.equal(failure.code, "ECONNRESET");
});
