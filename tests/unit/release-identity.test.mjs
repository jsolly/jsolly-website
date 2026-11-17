import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "vitest";
import { GET } from "../../src/pages/release.json.ts";

const INVALID_BUILD_SHA = /Build requires a full git release SHA/u;

function withBuildEnvironment(vercel, github, action) {
	const previous = {
		vercel: process.env.VERCEL_GIT_COMMIT_SHA,
		github: process.env.GITHUB_SHA,
	};
	try {
		if (vercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
		else process.env.VERCEL_GIT_COMMIT_SHA = vercel;
		if (github === undefined) delete process.env.GITHUB_SHA;
		else process.env.GITHUB_SHA = github;
		return action();
	} finally {
		if (previous.vercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
		else process.env.VERCEL_GIT_COMMIT_SHA = previous.vercel;
		if (previous.github === undefined) delete process.env.GITHUB_SHA;
		else process.env.GITHUB_SHA = previous.github;
	}
}

it("release identity prefers Vercel's commit over GitHub's commit", async () => {
	const response = withBuildEnvironment("a".repeat(40), "b".repeat(40), GET);
	assert.equal(response.headers.get("content-type"), "application/json");
	assert.deepEqual(await response.json(), { sha: "a".repeat(40) });
});

it("release identity uses GitHub's commit without a Vercel commit", async () => {
	const response = withBuildEnvironment(undefined, "b".repeat(40), GET);
	assert.deepEqual(await response.json(), { sha: "b".repeat(40) });
});

it("release identity falls back to Git HEAD without supplied commits", async () => {
	const expected = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	const response = withBuildEnvironment(undefined, undefined, GET);
	assert.deepEqual(await response.json(), { sha: expected });
});

it("release identity rejects malformed supplied commits without falling through", () => {
	for (const [vercel, github] of [
		["short", "b".repeat(40)],
		[undefined, "short"],
		["A".repeat(40), "b".repeat(40)],
		["a".repeat(41), "b".repeat(40)],
	]) {
		assert.throws(
			() => withBuildEnvironment(vercel, github, GET),
			INVALID_BUILD_SHA,
		);
	}
});
