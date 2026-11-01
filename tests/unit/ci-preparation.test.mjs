import assert from "node:assert/strict";
import { it } from "vitest";
import {
	preparationRun,
	waitForPreparation,
} from "../../gate/wait-ci-preparation.mjs";

const AMBIGUOUS = /Ambiguous/u;
const INCOMPLETE = /Incomplete/u;
const HTTP_ERROR = /HTTP 403/u;
const UNKNOWN = /Unknown/u;
const MALFORMED = /Malformed/u;
const OVERDUE = /readiness exceeded/u;
const id = {
	repo: "owner/repo",
	run: "123",
	attempt: "2",
	head: "a".repeat(40),
};
const job = {
	name: "prepare",
	run_id: 123,
	run_attempt: 2,
	head_sha: id.head,
	status: "completed",
	conclusion: "success",
};
const response = (jobs) => ({ total_count: jobs.length, jobs });
function clock() {
	let time = 0;
	return {
		now: () => time,
		pause: (ms) => {
			time += ms;
		},
	};
}
it("waits through missing, queued and running preparation before actual success", async () => {
	const states = [
		response([]),
		response([{ ...job, status: "queued", conclusion: null }]),
		response([{ ...job, status: "in_progress", conclusion: null }]),
		response([job]),
	];
	const requests = [];
	await waitForPreparation(id, {
		...clock(),
		request: (path) => {
			requests.push(path);
			return states.shift();
		},
	});
	assert.equal(states.length, 0);
	assert.equal(requests.length, 4);
	assert.ok(
		requests.every(
			(path) =>
				path ===
				"repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100&page=1",
		),
	);
});
it("rejects failed, cancelled and skipped preparation instead of beginning tests", async () => {
	await Promise.all(
		["failure", "cancelled", "skipped", "timed_out", null].map((conclusion) =>
			assert.rejects(
				waitForPreparation(id, {
					...clock(),
					request: () => response([{ ...job, conclusion }]),
				}),
			),
		),
	);
});
it("rejects wrong run, stale attempt and wrong event head", async () => {
	await Promise.all(
		[
			["run_id", 124],
			["run_attempt", 1],
			["head_sha", "b".repeat(40)],
		].map(([key, value]) =>
			assert.rejects(
				waitForPreparation(id, {
					...clock(),
					request: () => response([{ ...job, [key]: value }]),
				}),
			),
		),
	);
});
it("reads all pages and rejects duplicate or incomplete preparation evidence", async () => {
	const first = Array.from({ length: 100 }, (_, index) => ({
		name: `other-${index}`,
	}));
	const pages = [
		{ total_count: 101, jobs: first },
		{ total_count: 101, jobs: [job] },
	];
	await waitForPreparation(id, {
		...clock(),
		request: () => pages.shift(),
	});
	assert.equal(pages.length, 0);
	await assert.rejects(
		waitForPreparation(id, {
			...clock(),
			request: () => response([job, job]),
		}),
		AMBIGUOUS,
	);
	await assert.rejects(
		waitForPreparation(id, {
			...clock(),
			request: () => ({ total_count: 2, jobs: [job] }),
		}),
		INCOMPLETE,
	);
});
it("surfaces API failures and malformed statuses without treating them as pending", async () => {
	await assert.rejects(
		waitForPreparation(id, {
			...clock(),
			request: () => {
				throw new Error("HTTP 403");
			},
		}),
		HTTP_ERROR,
	);
	await assert.rejects(
		waitForPreparation(id, {
			...clock(),
			request: () => response([{ ...job, status: "unknown" }]),
		}),
		UNKNOWN,
	);
	await assert.rejects(
		waitForPreparation(id, {
			...clock(),
			request: () => ({ jobs: null }),
		}),
		MALFORMED,
	);
});
it("bounds pending readiness without altering any test deadline", async () => {
	await assert.rejects(
		waitForPreparation(id, {
			...clock(),
			timeout: 4000,
			request: () => response([]),
		}),
		OVERDUE,
	);
});
it("uses PR event head separately from the merge checkout and validates API identity inputs", () => {
	const env = {
		GITHUB_REPOSITORY: id.repo,
		GITHUB_RUN_ID: id.run,
		GITHUB_RUN_ATTEMPT: id.attempt,
		GITHUB_EVENT_NAME: "pull_request",
		GITHUB_SHA: "b".repeat(40),
	};
	const event = { pull_request: { head: { sha: id.head } } };
	assert.deepEqual(preparationRun(env, event), id);
	assert.equal(
		preparationRun({ ...env, GITHUB_EVENT_NAME: "push" }, {}).head,
		env.GITHUB_SHA,
	);
	for (const [key, value] of [
		["GITHUB_REPOSITORY", "bad/../../path"],
		["GITHUB_RUN_ID", "0"],
		["GITHUB_RUN_ATTEMPT", ""],
		["GITHUB_SHA", "bad"],
	])
		assert.throws(() =>
			preparationRun({ ...env, GITHUB_EVENT_NAME: "push", [key]: value }, {}),
		);
	assert.throws(() => preparationRun(env, {}));
});
