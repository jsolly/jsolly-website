import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { auditOutcome, reportEvents } from "../accessibility-report.mjs";
import { callShape, eventsOf, fakeAwsCli, sentTo } from "./fake-aws-cli.mjs";

const SCRIPT = fileURLToPath(
	new URL("../accessibility-report.mjs", import.meta.url),
);
const FIXTURE = fileURLToPath(
	new URL("../fixtures/accessibility-results.json", import.meta.url),
);
const POST = "/blog/UI-enhancement-leads-to-major-architecture-changes/";
// The payload must carry no control, format or line-separator characters.
const RIGHT_TO_LEFT_OVERRIDE = "\u202e";
const ZERO_WIDTH_SPACE = "\u200b";
const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const run = {
	serverUrl: "https://github.com",
	repository: "jsolly/jsolly-website",
	repo: "jsolly-website",
	runId: "123",
	runAttempt: "2",
	sha: "a".repeat(40),
};
// shared-infra's heartbeat filter matches repo and check literally.
const common = {
	repo: "jsolly-website",
	check: "a11y",
	run_url:
		"https://github.com/jsolly/jsolly-website/actions/runs/123/attempts/2",
	sha: "a".repeat(40),
};
// The events the fixture must produce, written out rather than computed.
const FIXTURE_EVENTS = [
	{
		level: "error",
		event: "a11y-violation",
		...common,
		page: "/about/",
		width: 390,
		rule: "color-contrast",
		impact: "serious",
		help: "Elements must meet minimum color contrast ratio thresholds",
	},
	{
		level: "error",
		event: "a11y-violation",
		...common,
		page: POST,
		width: 1280,
		rule: "image-alt",
		impact: "critical",
		help: "Images must have alternative text",
	},
	{
		level: "error",
		event: "a11y-violation",
		...common,
		page: POST,
		width: 1280,
		rule: "link-name",
		impact: "serious",
		help: "Links must have discernible text",
	},
	{
		level: "info",
		event: "heartbeat",
		...common,
		outcome: "fail",
		violations: 3,
	},
];
const clean = (routes) => ({
	expected: routes.length * 2,
	error: null,
	results: routes.flatMap((path) =>
		[1280, 390].map((width) => ({
			path,
			width,
			violations: [],
			incomplete: [],
		})),
	),
});
const report = (text, jobResult, { artifactId = "", synthetic = false } = {}) =>
	reportEvents({
		run,
		...auditOutcome(text, jobResult, artifactId),
		synthetic,
	});
const json = (value) => JSON.stringify(value);
const failureOf = (events) =>
	events.find((e) => e.event === "check-failed")?.message;

it("reports one error line per failing page, width and rule, then the heartbeat", () => {
	const events = report(readFileSync(FIXTURE, "utf8"), "failure");
	assert.deepEqual(events, FIXTURE_EVENTS);
	// No page markup, selectors or review-only findings leave the runner.
	for (const leaked of ["Secret page markup", "contact-me-heading", "<a href"])
		assert.ok(!json(events).includes(leaked), leaked);
});

it("a clean, complete audit writes only a passing heartbeat", () => {
	assert.deepEqual(report(json(clean(["/", "/about/"])), "success"), [
		{
			level: "info",
			event: "heartbeat",
			...common,
			outcome: "pass",
			violations: 0,
		},
	]);
});

// The contract allows 50 violation lines per run, then one truncation line.
it("caps violation lines at 50 and reports the omitted count", () => {
	// 30 routes at two widths, one violation each: 60 findings.
	const routes = Array.from(
		{ length: 30 },
		(_, i) => `/recipes/source-keto-recipe-${i}/`,
	);
	const audit = clean(routes);
	for (const result of audit.results)
		result.violations = [
			{
				id: "color-contrast",
				impact: "serious",
				help: "Elements must meet minimum color contrast ratio thresholds",
				nodes: [],
			},
		];
	const events = report(json(audit), "failure");
	assert.equal(events.filter((e) => e.event === "a11y-violation").length, 50);
	assert.deepEqual(events.at(-2), {
		level: "error",
		event: "violations-truncated",
		...common,
		omitted: 10,
	});
	assert.equal(events.at(-1).event, "heartbeat");
	assert.equal(events.at(-1).violations, 60);
	assert.equal(events.length, 52);
});

it("reports a crashed, incomplete or missing audit with a fixed check-failed message", () => {
	const crashed = JSON.parse(readFileSync(FIXTURE, "utf8"));
	crashed.error =
		"Hydration failed for 390px /recipes/meals/\n    at http://127.0.0.1:1/x.js TOKEN=secret";
	crashed.results = crashed.results.slice(0, 3);
	const events = report(json(crashed), "failure");
	// Partial findings still alert; the audit's own error text never leaves the runner.
	assert.deepEqual(
		events.map((e) => e.event),
		[
			"a11y-violation",
			"a11y-violation",
			"a11y-violation",
			"check-failed",
			"heartbeat",
		],
	);
	assert.equal(
		failureOf(events),
		"The audit stopped before completing; see the run's accessibility-results artifact.",
	);
	assert.ok(!json(events).includes("secret"));
	assert.equal(events.at(-1).outcome, "fail");

	const incomplete = clean(["/", "/about/"]);
	incomplete.results.pop();
	assert.equal(
		failureOf(report(json(incomplete), "failure")),
		"Incomplete accessibility audit: 3/4 page-viewports.",
	);
	assert.equal(
		failureOf(report(json(clean(["/"])), "failure")),
		"The audit job ended failure after a clean audit.",
	);
	assert.deepEqual(report(null, "failure"), [
		{
			level: "error",
			event: "check-failed",
			...common,
			message:
				"The audit job ended failure without accessibility results (setup, build or audit start failed).",
		},
		{
			level: "info",
			event: "heartbeat",
			...common,
			outcome: "fail",
			violations: 0,
		},
	]);
	// An audit that published its artifact, which never arrived, is a handoff
	// failure whether the audit passed or found violations.
	for (const jobResult of ["success", "failure"])
		assert.equal(
			failureOf(report(null, jobResult, { artifactId: "4242" })),
			`The audit job ended ${jobResult} and published its accessibility results, but they did not reach the reporter (artifact handoff failed).`,
		);
});

it("reports unreadable results as check-failed and still sends the heartbeat", () => {
	for (const text of [
		"{",
		"[]",
		"null",
		'{"expected":2,"error":null}',
		'{"expected":1,"error":null,"results":[{"violations":[null]}]}',
		'{"expected":1,"error":{"stack":"x"},"results":[]}',
		// Each result names its route and one of the audited widths, 1280 or 390.
		'{"expected":1,"error":null,"results":[{"width":390,"violations":[]}]}',
		'{"expected":1,"error":null,"results":[{"path":1,"width":390,"violations":[]}]}',
		'{"expected":1,"error":null,"results":[{"path":"/","width":"390\\n","violations":[]}]}',
		'{"expected":1,"error":null,"results":[{"path":"/","width":0,"violations":[]}]}',
		'{"expected":1,"error":null,"results":[{"path":"/","width":800,"violations":[]}]}',
	])
		assert.deepEqual(
			report(text, "success").map((e) => [e.event, e.message]),
			[
				[
					"check-failed",
					"The audit wrote unreadable accessibility results; see the run's accessibility-results artifact.",
				],
				["heartbeat", undefined],
			],
			text,
		);
});

it("adds one synthetic violation only when requested", () => {
	const audit = json(clean(["/"]));
	assert.deepEqual(
		report(audit, "success", { synthetic: true }).map((e) => [
			e.level,
			e.event,
			e.rule,
		]),
		[
			["error", "a11y-violation", "synthetic-alert-test"],
			["info", "heartbeat", undefined],
		],
	);
	assert.equal(
		report(audit, "success", { synthetic: true }).at(-1).outcome,
		"fail",
	);
	assert.equal(report(audit, "success").at(-1).outcome, "pass");
});

it("sends only single-line, bounded strings and no request ids", () => {
	const audit = clean(["/about/"]);
	audit.expected = 1;
	audit.results = [audit.results[0]];
	audit.results[0].path = `/a\r\nb\u0085c/${"p".repeat(900)}`;
	audit.results[0].violations = [
		{
			id: `color${RIGHT_TO_LEFT_OVERRIDE}contrast${ZERO_WIDTH_SPACE}`,
			impact: "serious\u0007",
			help: `Help\u2028${"h".repeat(900)}`,
			requestId: "abc",
			nodes: [],
		},
	];
	const events = reportEvents({
		run: { ...run, sha: `${"b".repeat(40)}\n` },
		...auditOutcome(json(audit), "failure", "4242"),
	});
	assert.ok(events.every((event) => !("requestId" in event)));
	const values = events.flatMap((event) => Object.values(event));
	assert.deepEqual(
		values
			.filter((value) => typeof value === "string")
			.filter((value) => value.length > 500 || UNSAFE.test(value)),
		[],
	);
	assert.ok(
		values
			.filter((value) => typeof value !== "string")
			.every((value) => Number.isSafeInteger(value) && value >= 0),
	);
	const [violation] = events;
	assert.equal(violation.page.length, 500);
	assert.ok(violation.page.startsWith("/a b c/p"));
	assert.equal(violation.width, 1280);
	assert.equal(violation.rule, "color contrast");
	assert.equal(violation.impact, "serious");
	assert.equal(violation.help.length, 500);
	assert.equal(violation.sha, "b".repeat(40));
});

it("cuts long values without splitting a surrogate pair", () => {
	const audit = clean(["/about/"]);
	audit.expected = 1;
	audit.results = [audit.results[0]];
	// The emoji's two code units sit at 498 and 499, across the 499-unit cut.
	const straddling = `${"p".repeat(498)}\u{1f600}${"q".repeat(10)}`;
	audit.results[0].violations = [
		{
			id: "color-contrast",
			impact: "serious",
			help: straddling,
			nodes: [],
		},
		{
			id: "image-alt",
			impact: "critical",
			help: "Lone \ud83d surrogate",
			nodes: [],
		},
	];
	const [cut, lone] = report(json(audit), "failure");
	assert.equal(cut.help, `${"p".repeat(498)}…`);
	assert.ok(cut.help.isWellFormed());
	assert.equal(lone.help, "Lone \ufffd surrogate");
	// Any value whose last kept unit is an emoji's first half would fail here.
	const whole = `${"p".repeat(497)}\u{1f600}${"q".repeat(10)}`;
	audit.results[0].violations[0].help = whole;
	const [kept] = report(json(audit), "failure");
	assert.equal(kept.help, `${"p".repeat(497)}\u{1f600}…`);
	assert.ok(kept.help.isWellFormed());
});

// The CLI against the stand-in aws (fake-aws-cli.mjs), never reaching AWS.
function cliFixture(t) {
	const { root, file, run: runScript } = fakeAwsCli(t, "a11y");
	const cli = (
		results,
		jobResult,
		{ artifactId = "", synthetic = "false", mode = "" } = {},
	) =>
		runScript(
			SCRIPT,
			{
				GITHUB_SERVER_URL: run.serverUrl,
				GITHUB_REPOSITORY: run.repository,
				GITHUB_RUN_ID: run.runId,
				GITHUB_RUN_ATTEMPT: run.runAttempt,
				GITHUB_SHA: run.sha,
				AUDIT_JOB_RESULT: jobResult,
				A11Y_ARTIFACT_ID: artifactId,
				A11Y_RESULTS: results,
				A11Y_SYNTHETIC: synthetic,
			},
			mode,
		);
	return { root, file, cli };
}
const SENT = sentTo("jsolly-website/a11y/123-2");
const REJECTED = /CloudWatch Logs rejected events/u;

it("writes the run's events to its own log stream and exits 1 on error lines", (t) => {
	const { file, cli } = cliFixture(t);
	const failed = cli(FIXTURE, "failure");
	assert.deepEqual(callShape(failed.calls), SENT);
	assert.equal(failed.status, 1, failed.stderr);
	assert.deepEqual(eventsOf(failed.calls), FIXTURE_EVENTS);
	assert.deepEqual(failed.leftovers, []);

	const clean2 = file("clean.json", json(clean(["/"])));
	const passing = cli(clean2, "success");
	assert.deepEqual(callShape(passing.calls), SENT);
	assert.equal(passing.status, 0, passing.stderr);
	assert.deepEqual(passing.leftovers, []);
	assert.deepEqual(eventsOf(passing.calls), [
		{
			level: "info",
			event: "heartbeat",
			...common,
			outcome: "pass",
			violations: 0,
		},
	]);
	const synthetic = cli(clean2, "success", { synthetic: "true" });
	assert.deepEqual(callShape(synthetic.calls), SENT);
	assert.equal(synthetic.status, 1);
	assert.deepEqual(
		eventsOf(synthetic.calls).map((e) => e.event),
		["a11y-violation", "heartbeat"],
	);
});

it("still sends check-failed and the heartbeat when the results are missing or unreadable", (t) => {
	const { root, file, cli } = cliFixture(t);
	const missing = cli(
		join(root, "absent", "accessibility-results.json"),
		"failure",
	);
	assert.deepEqual(callShape(missing.calls), SENT);
	assert.equal(missing.status, 1, missing.stderr);
	assert.deepEqual(
		eventsOf(missing.calls).map((e) => e.event),
		["check-failed", "heartbeat"],
	);
	const unreadable = cli(file("bad.json", "{"), "success");
	assert.deepEqual(callShape(unreadable.calls), SENT);
	assert.equal(unreadable.status, 1, unreadable.stderr);
	const events = eventsOf(unreadable.calls);
	assert.deepEqual(
		events.map((e) => e.event),
		["check-failed", "heartbeat"],
	);
	assert.equal(
		events[0].message,
		"The audit wrote unreadable accessibility results; see the run's accessibility-results artifact.",
	);
	// The audit found violations and published its artifact, but no file arrived.
	const handoff = cli(
		join(root, "absent", "accessibility-results.json"),
		"failure",
		{ artifactId: "4242" },
	);
	assert.deepEqual(callShape(handoff.calls), SENT);
	assert.equal(handoff.status, 1, handoff.stderr);
	assert.deepEqual(
		eventsOf(handoff.calls).map((e) => [e.event, e.message]),
		[
			[
				"check-failed",
				"The audit job ended failure and published its accessibility results, but they did not reach the reporter (artifact handoff failed).",
			],
			["heartbeat", undefined],
		],
	);
});

it("fails when the AWS CLI fails or CloudWatch rejects events", (t) => {
	const { file, cli } = cliFixture(t);
	const results = file("clean.json", json(clean(["/"])));
	const create = cli(results, "success", { mode: "create-fails" });
	assert.notEqual(create.status, 0);
	assert.deepEqual(
		create.calls.map(({ args }) => args[1]),
		["create-log-stream"],
	);
	assert.deepEqual(create.leftovers, []);
	const rejected = cli(results, "success", { mode: "rejected" });
	assert.notEqual(rejected.status, 0);
	assert.match(rejected.stderr, REJECTED);
});
