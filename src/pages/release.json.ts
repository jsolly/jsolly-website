import { execFileSync } from "node:child_process";

const FULL_SHA = /^[a-f0-9]{40}$/u;

export function GET() {
	const sha =
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.GITHUB_SHA ||
		execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	if (!FULL_SHA.test(sha))
		throw new Error("Build requires a full git release SHA");
	return Response.json({ sha });
}
