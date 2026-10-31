import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { eventsOf, fakeAwsCli } from "./fake-aws-cli.mjs";

const ONE_ERROR_REPORTED = /\{"errors":1\}/u;
const UNSAFE_LEFT = /[\n\u202e]/u;
const WRITER = fileURLToPath(
	new URL("../scheduled-check-report.mjs", import.meta.url),
);

// A future reporter that forgets to bound its events still cannot send raw text
// into retained logs and alert email: the writer bounds every value itself.
it("a reporter that forgets to bound its events still cannot put multi-line or bidi text into alert email", (t) => {
	const { file, run } = fakeAwsCli(t, "raw-check");
	const raw = `first line\nsecond line\u202e${"x".repeat(900)}`;
	const script = file(
		"send-raw.mjs",
		`import { runFromEnv, sendEvents } from ${JSON.stringify(WRITER)};
const run = runFromEnv(process.env);
const errors = sendEvents({ run, check: "raw-check", events: [
  { level: "error", event: "check-failed", message: ${JSON.stringify(raw)}, count: 3 },
] });
console.log(JSON.stringify({ errors }));
`,
	);
	const result = run(script, {
		GITHUB_SERVER_URL: "https://github.com",
		GITHUB_REPOSITORY: "jsolly/jsolly-website",
		GITHUB_RUN_ID: "41244187263",
		GITHUB_RUN_ATTEMPT: "1",
		GITHUB_SHA: "d".repeat(40),
	});
	assert.equal(result.status, 0, result.stderr);
	// The writer reports the error count and leaves the exit code to its caller.
	assert.match(result.stdout, ONE_ERROR_REPORTED);
	const [sent] = eventsOf(result.calls);
	assert.equal(sent.count, 3);
	assert.equal(sent.message.length, 500);
	assert.ok(sent.message.startsWith("first line second line "));
	assert.ok(sent.message.endsWith("…"));
	assert.doesNotMatch(sent.message, UNSAFE_LEFT);
});
