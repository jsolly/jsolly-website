import { next, rewrite } from "@vercel/edge";
import { SITE_SEARCH_LINK } from "./src/content/constants.js";
// Written by astro build (routeManifest in config/app/astro.ts); gitignored, typed by the tracked .d.ts.
import { markdownRoutes as builtMarkdownRoutes } from "./src/generated/route-manifest.js";
import {
	appendVaryAccept,
	shouldNegotiate,
} from "./src/lib/accept-negotiate.js";
import { agentResponse } from "./src/lib/agent-response.js";
import { previewResponseHeaders } from "./src/lib/csp-policy.js";
import { recipeBrowseDestination } from "./src/lib/recipe-browse-route.mjs";
// biome-ignore lint/correctness/useJsonImportAttributes: Vercel's middleware bundler rejects import attributes (scripts/unit/middleware-bundle.test.mjs).
import vercelConfig from "./vercel.json";

const markdownRoutes = new Map(builtMarkdownRoutes);
// Preview deployments widen the header CSP for the Vercel Toolbar; empty in production.
const previewHeaders = previewResponseHeaders(
	process.env.VERCEL_ENV,
	vercelConfig,
);

/** Same URL serves HTML or Markdown based on Accept, with Vary keeping CDN variants apart. */
export default function middleware(request: Request) {
	const url = new URL(request.url);

	const negotiated = agentResponse(request, markdownRoutes);
	if (negotiated) return negotiated;

	const browse = recipeBrowseDestination(request);
	if (browse)
		return rewrite(browse, {
			headers: {
				"Cache-Control": "no-store",
				Vary: "Accept",
				Link: SITE_SEARCH_LINK,
				...previewHeaders,
			},
		});

	const response = next({ headers: previewHeaders });
	if (shouldNegotiate(url.pathname, request.method)) {
		appendVaryAccept(response.headers);
		response.headers.append("Link", SITE_SEARCH_LINK);
	}
	return response;
}
