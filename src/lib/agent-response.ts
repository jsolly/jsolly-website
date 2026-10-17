import { next, rewrite } from "@vercel/edge";
import {
	maintenanceMarkdown,
	markdownForPath,
	notFoundMarkdown,
	withSiteSearch,
} from "../content/agent-pages.js";
import { SITE_SEARCH_LINK } from "../content/constants.js";
import {
	appendVaryAccept,
	normalizePagePath,
	preferredType,
	shouldNegotiate,
	TRAILING_SLASHES_RE,
} from "./accept-negotiate.js";

/**
 * Markdown / 406 response, or null to fall through to HTML or the static file.
 * `markdownRoutes` lists generated static siblings; bodies never enter the edge bundle.
 */
export function agentResponse(
	request: Request,
	markdownRoutes: ReadonlyMap<string, string>,
): Response | null {
	if (!["GET", "HEAD"].includes(request.method.toUpperCase())) return null;
	const url = new URL(request.url);
	if (!shouldNegotiate(url.pathname, request.method)) return null;
	const maintenance = process.env.MAINTENANCE_MODE === "true";

	const pathNoSlash = url.pathname.replace(TRAILING_SLASHES_RE, "") || "/";
	if (pathNoSlash.toLowerCase().endsWith(".md")) {
		if (maintenance) {
			return markdownBody(request, maintenanceMarkdown(url.origin), 503);
		}
		return markdownResponse(request, url, markdownRoutes);
	}

	const chosen = preferredType(request.headers.get("accept"));
	if (chosen === null) {
		return notAcceptable(request);
	}
	if (chosen === "text/markdown") {
		if (maintenance) {
			return markdownBody(request, maintenanceMarkdown(url.origin), 503);
		}
		return markdownResponse(request, url, markdownRoutes);
	}
	return null;
}

function markdownResponse(
	request: Request,
	url: URL,
	markdownRoutes: ReadonlyMap<string, string>,
): Response {
	const origin = url.origin;
	const pageKey = normalizePagePath(url.pathname);
	const sibling = markdownRoutes.get(pageKey);
	if (sibling) {
		const destination = new URL(url);
		destination.pathname = sibling.split("/").map(encodeURIComponent).join("/");
		destination.search = "";
		const headers = markdownHeaders();
		return url.pathname === destination.pathname
			? next({ headers })
			: rewrite(destination, { headers });
	}
	const pageBody = markdownForPath(pageKey, origin);
	const status = pageBody ? 200 : 404;
	const body = pageBody ?? notFoundMarkdown(origin);
	return markdownBody(request, body, status);
}

function markdownBody(
	request: Request,
	body: string,
	status: number,
): Response {
	const headers = markdownHeaders();
	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, { status, headers });
	}
	return new Response(withSiteSearch(body), { status, headers });
}

function markdownHeaders(): Headers {
	const headers = new Headers({
		"content-type": "text/markdown; charset=utf-8",
		"cache-control": "public, max-age=0, must-revalidate",
		link: SITE_SEARCH_LINK,
	});
	appendVaryAccept(headers);
	return headers;
}

function notAcceptable(request: Request): Response {
	const headers = new Headers({
		"content-type": "text/plain; charset=utf-8",
	});
	appendVaryAccept(headers);
	return new Response(
		request.method.toUpperCase() === "HEAD"
			? null
			: "Not Acceptable. This resource is available as text/html or text/markdown.",
		{
			status: 406,
			headers,
		},
	);
}
