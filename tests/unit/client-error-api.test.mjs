import assert from "node:assert/strict";
import { PutLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { beforeEach, it, vi } from "vitest";
import { CLIENT_ERROR_LOG } from "../../src/lib/client-error-constants.mjs";
import { ERROR_CATEGORIES } from "../../src/lib/error-categories.mjs";

const { send, failedForward, checkRateLimit } = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	send: vi.fn(),
	failedForward: vi.fn(),
}));

vi.mock("@vercel/firewall", () => ({ checkRateLimit }));

// Vitest supplies a unit-only route manifest before a build exists. Keep the
// API's real handler and recorder, replacing only the external AWS client.
vi.mock("../../src/lib/client-error-sink.mjs", async (original) => ({
	...(await original()),
	productionClient: () => ({ send }),
}));

// Only the external providers and server-owned test configuration are replaced.
vi.stubEnv("CLIENT_ERROR_BUCKET_SECRET", "unit-fixture-only-bucket-identifier");

// The handler captures console.error when the API module is evaluated.
const originalError = console.error;
let api;
try {
	console.error = failedForward;
	({ default: api } = await import("../../api/client-error.mjs"));
} finally {
	console.error = originalError;
}

const ORIGIN = "https://www.jsolly.com";
const PAGE = "/recipes/meals/";
const request = (body, extraHeaders = {}) =>
	new Request(`${ORIGIN}/api/client-error/`, {
		method: "POST",
		headers: {
			Origin: ORIGIN,
			"Content-Type": "application/json",
			...extraHeaders,
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

beforeEach(() => {
	checkRateLimit.mockReset();
	checkRateLimit.mockResolvedValue({ rateLimited: false });
	send.mockReset();
	send.mockResolvedValue({});
	failedForward.mockClear();
});

it("the API forwards each browser category to the configured CloudWatch destination", async () => {
	const categories = Object.entries(ERROR_CATEGORIES);
	const responses = await Promise.all(
		categories.map(([category]) =>
			api.fetch(request({ category, page: PAGE })),
		),
	);
	assert.equal(send.mock.calls.length, categories.length);
	const bodies = await Promise.all(
		responses.map((response) => response.text()),
	);
	for (const [index, [category, message]] of categories.entries()) {
		const response = responses[index];
		assert.equal(response.status, 204, category);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(bodies[index], "");
		const [command, options] = send.mock.calls.find(
			([candidate]) =>
				JSON.parse(candidate.input.logEvents[0].message).context.category ===
				category,
		);
		assert.ok(command instanceof PutLogEventsCommand);
		assert.equal(command.input.logGroupName, CLIENT_ERROR_LOG.logGroupName);
		assert.equal(command.input.logStreamName, CLIENT_ERROR_LOG.logStreamName);
		assert.equal(command.input.logEvents.length, 1);
		const [event] = command.input.logEvents;
		assert.ok(Number.isSafeInteger(event.timestamp));
		assert.deepEqual(JSON.parse(event.message), {
			level: "error",
			message: `Client error reported on ${PAGE}`,
			context: { category, page: PAGE },
			error: { name: category, message },
		});
		assert.ok(options.abortSignal instanceof AbortSignal);
		assert.equal(options.abortSignal.aborted, false);
	}
	assert.equal(failedForward.mock.calls.length, 0);
});

it("the API rejects invalid and oversized reports before invoking CloudWatch", async () => {
	const reports = [
		["not JSON", {}, 400],
		[{ category: "unknown", page: PAGE }, {}, 400],
		[{ category: "recipe-print", page: "/not-published/" }, {}, 400],
		[
			{ category: "recipe-print", page: PAGE, message: "private input" },
			{},
			400,
		],
		[" ".repeat(513), {}, 400],
		[
			{ category: "recipe-print", page: PAGE },
			{ "Content-Length": "513" },
			413,
		],
	];
	const responses = await Promise.all(
		reports.map(([body, headers]) => api.fetch(request(body, headers))),
	);
	assert.deepEqual(
		responses.map((response) => response.status),
		reports.map(([, , status]) => status),
	);
	assert.deepEqual(
		await Promise.all(responses.map((response) => response.text())),
		reports.map(() => ""),
	);
	assert.equal(send.mock.calls.length, 0);
	assert.equal(failedForward.mock.calls.length, 0);
});

it("the API forwards the production probe as info without creating an error event", async () => {
	const response = await api.fetch(
		request({ category: "forwarding-probe", page: "/" }),
	);
	assert.equal(response.status, 204);
	assert.equal(send.mock.calls.length, 1);
	const [command] = send.mock.lastCall;
	assert.deepEqual(JSON.parse(command.input.logEvents[0].message), {
		level: "info",
		message: "Production smoke verified client-error forwarding.",
		context: { category: "forwarding-probe", page: "/" },
	});
	assert.equal(failedForward.mock.calls.length, 0);
});

it("the API returns 502 and a sanitized diagnostic when CloudWatch rejects a forward", async () => {
	send.mockRejectedValueOnce(
		Object.assign(new Error("private provider credential detail"), {
			name: "AccessDeniedException",
			$metadata: { httpStatusCode: 403 },
		}),
	);
	const response = await api.fetch(
		request({ category: "recipe-print", page: PAGE }),
	);
	assert.equal(response.status, 502);
	assert.equal(await response.text(), "");
	assert.equal(send.mock.calls.length, 1);
	assert.equal(failedForward.mock.calls.length, 1);
	assert.deepEqual(JSON.parse(failedForward.mock.calls[0][0]), {
		event: "client-error-forward-failed",
		category: "recipe-print",
		page: PAGE,
		message: "Recipe printing failed.",
		error: "AccessDeniedException",
		status: 403,
	});
});

it("the deployed API skips CloudWatch on budget exhaustion, duplicates and unavailable counters", async () => {
	for (const [id, result, status] of [
		["client-error-ingestion", { rateLimited: true }, 429],
		["client-error-duplicate", { rateLimited: true }, 204],
		["client-error-ingestion", { rateLimited: false, error: "not-found" }, 503],
		["client-error-duplicate", { rateLimited: true, error: "blocked" }, 503],
	]) {
		send.mockClear();
		checkRateLimit.mockImplementation(async (rule) =>
			rule === id ? result : { rateLimited: false },
		);
		assert.equal(
			// biome-ignore lint/performance/noAwaitInLoops: Each case changes shared API mocks after the previous call completes.
			(await api.fetch(request({ category: "recipe-print", page: PAGE })))
				.status,
			status,
		);
		assert.equal(send.mock.calls.length, 0);
		assert.equal(failedForward.mock.calls.length, 0);
	}
});

it("a timed-out limiter fails closed without a CloudWatch call or amplified failure log", async () => {
	checkRateLimit.mockRejectedValue(new Error("private limiter detail"));
	assert.equal(
		(await api.fetch(request({ category: "recipe-print", page: PAGE }))).status,
		503,
	);
	assert.equal(send.mock.calls.length, 0);
	assert.equal(failedForward.mock.calls.length, 0);
});
