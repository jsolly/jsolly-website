import { next } from "@vercel/edge";
import {
	appendVaryAccept,
	shouldNegotiate,
} from "./src/lib/accept-negotiate.js";
import { agentResponse } from "./src/lib/agent-response.js";

/**
 * Request-time release id for static Vercel sites.
 * Vercel applies committed vercel.json headers as-is (build-time stamps do not stick),
 * so Edge Middleware reads the deployment's VERCEL_GIT_COMMIT_SHA instead.
 *
 * Also implements acceptmarkdown.com negotiation: same URL serves HTML or
 * text/markdown based on Accept, with Vary: Accept so the CDN keeps variants apart.
 */
export default function middleware(request: Request) {
	const url = new URL(request.url);
	const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
	const releaseId = sha ? sha.slice(0, 12) : "dev";

	const negotiated = agentResponse(request, releaseId);
	if (negotiated) return negotiated;

	const response = next();
	response.headers.set("x-release-id", releaseId);
	if (shouldNegotiate(url.pathname, request.method)) {
		appendVaryAccept(response.headers);
	}
	return response;
}
