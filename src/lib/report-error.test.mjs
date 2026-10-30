import assert from "node:assert/strict";
import { it } from "vitest";
import { installErrorReporting } from "./report-error.mjs";
import { createErrorReporter } from "./report-error-client.mjs";

it("sends only category and pathname, omitting cookies, referrer, query and fragment", async () => {
	const calls = [];
	const report = createErrorReporter({
		location: () =>
			new URL("https://www.jsolly.com/recipes/meals/?searched=private#private"),
		fetcher: (...args) => {
			calls.push(args);
			return Promise.resolve();
		},
	});
	await report("recipe-print");
	assert.equal(calls.length, 1);
	const [url, options] = calls[0];
	assert.equal(url, "/api/client-error/");
	assert.deepEqual(JSON.parse(options.body), {
		category: "recipe-print",
		page: "/recipes/meals/",
	});
	assert.equal(options.credentials, "omit");
	assert.equal(options.referrerPolicy, "no-referrer");
	assert.equal(options.redirect, "error");
	assert.equal(options.cache, "no-store");
	assert.equal(options.method, "POST");
	assert.ok(options.signal instanceof AbortSignal);
});

it("deduplicates categories and caps attempts at three per page load without durable state", async () => {
	const calls = [];
	const report = createErrorReporter({
		location: () => new URL("https://www.jsolly.com/"),
		fetcher: (_url, options) => {
			calls.push(JSON.parse(options.body));
			return Promise.resolve();
		},
	});
	await report("recipe-print");
	await report("recipe-print");
	await report("recipe-share");
	await report("recipe-copy");
	await report("client-runtime");
	assert.deepEqual(
		calls.map((call) => call.category),
		["recipe-print", "recipe-share", "recipe-copy"],
	);
});

it("silently contains network rejection and synchronous browser failures", async () => {
	const network = createErrorReporter({
		location: () => new URL("https://www.jsolly.com/"),
		fetcher: () => Promise.reject(new Error("private network detail")),
	});
	const browser = createErrorReporter({
		location: () => {
			throw new Error("private browser detail");
		},
	});
	await assert.doesNotReject(network("recipe-print"));
	await assert.doesNotReject(browser("recipe-print"));
});

it("does not send unknown categories or requests from local and Preview builds", async () => {
	const calls = [];
	const fetcher = (...args) => {
		calls.push(args);
		return Promise.resolve();
	};
	await createErrorReporter({
		location: () => new URL("http://localhost:4321/"),
		fetcher,
	})("recipe-print");
	await createErrorReporter({
		location: () => new URL("https://preview.example/"),
		fetcher,
	})("recipe-print");
	await createErrorReporter({
		location: () => new URL("https://www.jsolly.com/"),
		fetcher,
	})("private exception message");
	assert.deepEqual(calls, []);
});

it("uncaught and handled hydration failures report only fixed categories", () => {
	const target = new EventTarget();
	const reports = [];
	const stop = installErrorReporting(target, (category) => {
		reports.push(category);
	});
	target.dispatchEvent(
		Object.assign(new Event("error"), { message: "private exception" }),
	);
	target.dispatchEvent(
		Object.assign(new Event("unhandledrejection"), {
			reason: "private promise value",
		}),
	);
	target.dispatchEvent(
		Object.assign(new Event("astro:hydration-error"), {
			detail: { error: "private hydration failure", componentUrl: "private" },
		}),
	);
	stop();
	target.dispatchEvent(new Event("error"));
	target.dispatchEvent(new Event("astro:hydration-error"));
	assert.deepEqual(reports, [
		"client-runtime",
		"client-async",
		"client-runtime",
	]);
});
