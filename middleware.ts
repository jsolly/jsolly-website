import { next } from "@vercel/edge";
import {
	appendVaryAccept,
	shouldNegotiate,
} from "./src/lib/accept-negotiate.js";
import { agentResponse } from "./src/lib/agent-response.js";

/** Same URL serves HTML or Markdown based on Accept, with Vary keeping CDN variants apart. */
export default function middleware(request: Request) {
	const url = new URL(request.url);

	const negotiated = agentResponse(request);
	if (negotiated) return negotiated;

	const response = next();
	if (shouldNegotiate(url.pathname, request.method)) {
		appendVaryAccept(response.headers);
	}
	return response;
}
