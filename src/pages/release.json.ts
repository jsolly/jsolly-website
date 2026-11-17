import { buildReleaseSha } from "../lib/build-release.js";

export function GET() {
	return Response.json({ sha: buildReleaseSha() });
}
