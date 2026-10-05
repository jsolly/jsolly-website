import { next } from "@vercel/edge";
// Written by astro build (routeManifest in astro.config.ts); gitignored, typed by the tracked .d.ts.
import { routes as builtRoutes } from "./src/generated/route-manifest.js";
import {
	appendVaryAccept,
	routeSet,
	shouldNegotiate,
} from "./src/lib/accept-negotiate.js";
import { agentResponse } from "./src/lib/agent-response.js";

const routes = routeSet(builtRoutes);

/** Same URL serves HTML or Markdown based on Accept, with Vary keeping CDN variants apart. */
export default function middleware(request: Request) {
	const url = new URL(request.url);

	const negotiated = agentResponse(request, routes);
	if (negotiated) return negotiated;

	const response = next();
	if (shouldNegotiate(url.pathname, request.method, routes)) {
		appendVaryAccept(response.headers);
	}
	return response;
}
