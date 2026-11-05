import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { it } from "vitest";

const FULL_SHA = /^[a-f0-9]{40}$/u;

it("the built release identity names the exact build commit", async () => {
	const expected =
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.GITHUB_SHA ||
		execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	const release = JSON.parse(await readFile("dist/release.json", "utf8"));
	assert.match(release.sha, FULL_SHA);
	assert.equal(release.sha, expected);
});
