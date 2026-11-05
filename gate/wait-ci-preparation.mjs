// biome-ignore-all lint/suspicious/noMisplacedAssertion lint/nursery/noConditionalExpect lint/performance/noAwaitInLoops: Runtime assertions validate paginated external job evidence and readiness is sequential.
import assert from "node:assert/strict";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/u;
const POSITIVE = /^[1-9][0-9]*$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function preparationRun(env, event) {
	assert.match(env.GITHUB_REPOSITORY ?? "", REPOSITORY);
	for (const value of [env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT])
		assert.match(value ?? "", POSITIVE);
	// Actions jobs describe the event head, while a PR checkout uses the merge SHA.
	const head =
		env.GITHUB_EVENT_NAME === "pull_request"
			? event.pull_request?.head?.sha
			: env.GITHUB_SHA;
	assert.match(head ?? "", SHA);
	return {
		repo: env.GITHUB_REPOSITORY,
		run: env.GITHUB_RUN_ID,
		attempt: env.GITHUB_RUN_ATTEMPT,
		head,
	};
}

export async function waitForPreparation(
	identity,
	{ request, pause = delay, now = Date.now, timeout = 300000 },
) {
	const deadline = now() + timeout;
	while (now() < deadline) {
		const jobs = [];
		let total;
		for (let page = 1; ; page++) {
			const result = await request(
				`repos/${identity.repo}/actions/runs/${identity.run}/attempts/${identity.attempt}/jobs?per_page=100&page=${page}`,
			);
			assert.ok(
				Array.isArray(result.jobs) &&
					Number.isInteger(result.total_count) &&
					result.total_count >= 0,
				"Malformed preparation jobs response",
			);
			total ??= result.total_count;
			assert.equal(
				result.total_count,
				total,
				"Job pagination changed during observation",
			);
			jobs.push(...result.jobs);
			assert.ok(jobs.length <= total, "Excess preparation jobs");
			if (result.jobs.length < 100) break;
		}
		assert.equal(jobs.length, total, "Incomplete preparation jobs pagination");
		const candidates = jobs.filter((job) => job.name === "prepare");
		assert.ok(candidates.length <= 1, "Ambiguous preparation jobs");
		if (candidates.length) {
			const job = candidates[0];
			assert.equal(String(job.run_id), identity.run, "Wrong preparation run");
			assert.equal(
				String(job.run_attempt),
				identity.attempt,
				"Wrong preparation attempt",
			);
			assert.equal(job.head_sha, identity.head, "Wrong preparation event head");
			if (job.status === "completed") {
				assert.equal(
					job.conclusion,
					"success",
					`Preparation completed: ${job.conclusion}`,
				);
				return;
			}
			assert.ok(
				["queued", "in_progress", "waiting", "pending", "requested"].includes(
					job.status,
				),
				"Unknown preparation status",
			);
		}
		await pause(Math.min(2000, Math.max(0, deadline - now())));
	}
	throw new Error("Preparation readiness exceeded 300 seconds");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const env = process.env;
		const identity = preparationRun(
			env,
			JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8")),
		);
		assert.ok(env.GH_TOKEN, "Missing Actions read token");
		await waitForPreparation(identity, {
			request: async (path) => {
				const response = await fetch(`https://api.github.com/${path}`, {
					headers: {
						Authorization: `Bearer ${env.GH_TOKEN}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
					},
					signal: AbortSignal.timeout(10000),
				});
				assert.ok(
					response.ok,
					`Preparation API returned HTTP ${response.status}`,
				);
				return response.json();
			},
		});
		console.log("Preparation succeeded for this workflow attempt.");
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
