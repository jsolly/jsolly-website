import assert from "node:assert/strict";
import { it } from "vitest";
import { createClientErrorHandler } from "./client-error-server.mjs";

const ORIGIN = "https://www.jsolly.com";
const REPORT = { category: "recipe-print", page: "/recipes/meals/" };
const HEADERS = { Origin: ORIGIN, "Content-Type": "application/json" };

function fixture() {
	const logs = [];
	return {
		logs,
		handle: createClientErrorHandler({
			paths: new Set(["/", "/recipes/meals/", "/privacy/"]),
			log: (value) => logs.push(value),
		}),
	};
}
const request = (body = JSON.stringify(REPORT), headers = HEADERS) =>
	new Request(`${ORIGIN}/api/client-error/`, { method: "POST", headers, body });

it("accepts a fixed category on a published path and logs only the allowed fields", async () => {
	const { handle, logs } = fixture();
	const response = await handle(request());
	assert.equal(response.status, 204);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.deepEqual(logs.map(JSON.parse), [
		{
			event: "client-error",
			category: "recipe-print",
			page: "/recipes/meals/",
			message: "Recipe printing failed.",
		},
	]);
	assert.equal(await response.text(), "");
});

it("rejects missing, cross-origin, or noncanonical origins without logging", async () => {
	const { handle, logs } = fixture();
	const responses = await Promise.all([
		handle(request(undefined, { "Content-Type": "application/json" })),
		handle(
			request(undefined, { ...HEADERS, Origin: "https://elsewhere.example" }),
		),
		handle(
			new Request("https://preview.example/api/client-error/", {
				method: "POST",
				headers: HEADERS,
				body: JSON.stringify(REPORT),
			}),
		),
	]);
	assert.deepEqual(
		responses.map((response) => response.status),
		[403, 403, 403],
	);
	assert.deepEqual(logs, []);
});

it("rejects GET and non-JSON submission types", async () => {
	const { handle, logs } = fixture();
	const get = await handle(new Request(`${ORIGIN}/api/client-error/`));
	assert.equal(get.status, 405);
	assert.equal(get.headers.get("allow"), "POST");
	const text = await handle(
		request(undefined, { ...HEADERS, "Content-Type": "text/plain" }),
	);
	assert.equal(text.status, 415);
	assert.deepEqual(logs, []);
});

it("rejects extra fields, unknown categories, and non-object JSON without logging raw input", async () => {
	const { handle, logs } = fixture();
	const bodies = [
		{ ...REPORT, message: "secret form text" },
		{ ...REPORT, stack: "private stack trace" },
		{ ...REPORT, category: "secret form text" },
		{ ...REPORT, category: "__proto__" },
		{ page: REPORT.page },
		null,
		[],
		"secret form text",
	];
	const responses = await Promise.all(
		bodies.map((body) => handle(request(JSON.stringify(body)))),
	);
	assert.deepEqual(
		responses.map((response) => response.status),
		bodies.map(() => 400),
	);
	assert.deepEqual(logs, []);
});

it("rejects arbitrary paths, query strings, fragments and encoded variants", async () => {
	const { handle, logs } = fixture();
	const pages = [
		"/private-name/",
		"/recipes/meals/?q=secret",
		"/recipes/meals/#secret",
		"/recipes/%6deals/",
		"https://www.jsolly.com/privacy/",
	];
	const responses = await Promise.all(
		pages.map((page) => handle(request(JSON.stringify({ ...REPORT, page })))),
	);
	assert.deepEqual(
		responses.map((response) => response.status),
		pages.map(() => 400),
	);
	assert.deepEqual(logs, []);
});

it("bounds the streamed body even without a Content-Length header", async () => {
	const { handle, logs } = fixture();
	const response = await handle(
		request(JSON.stringify({ ...REPORT, message: "x".repeat(600) })),
	);
	assert.equal(response.status, 400);
	assert.deepEqual(logs, []);
});

it("rejects excessive declared body size before parsing", async () => {
	const { handle, logs } = fixture();
	const response = await handle(
		request(undefined, { ...HEADERS, "Content-Length": "513" }),
	);
	assert.equal(response.status, 413);
	assert.deepEqual(logs, []);
});

it("rejects malformed JSON and invalid UTF-8 without echoing or logging it", async () => {
	const { handle, logs } = fixture();
	const responses = await Promise.all([
		handle(request("secret text")),
		handle(request(new Uint8Array([255]))),
	]);
	assert.deepEqual(
		responses.map((response) => response.status),
		[400, 400],
	);
	assert.deepEqual(
		await Promise.all(responses.map((response) => response.text())),
		["", ""],
	);
	assert.deepEqual(logs, []);
});
