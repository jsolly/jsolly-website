import {
	maintenanceMarkdown,
	markdownForPath,
	notFoundMarkdown,
} from "../content/agent-pages.js";
import {
	appendVaryAccept,
	normalizePagePath,
	preferredType,
	shouldNegotiate,
} from "./accept-negotiate.js";

/** Markdown / 406 response, or null to fall through to HTML. */
export function agentResponse(
	request: Request,
	releaseId: string,
): Response | null {
	const url = new URL(request.url);
	const maintenance = process.env.MAINTENANCE_MODE === "true";

	const pathNoSlash = url.pathname.replace(/\/+$/, "") || "/";
	if (pathNoSlash.toLowerCase().endsWith(".md")) {
		if (maintenance) {
			return markdownBody(
				request,
				maintenanceMarkdown(url.origin),
				503,
				releaseId,
			);
		}
		return markdownResponse(request, url, releaseId);
	}

	if (!shouldNegotiate(url.pathname, request.method)) {
		return null;
	}

	const chosen = preferredType(request.headers.get("accept"));
	if (chosen === null) {
		return notAcceptable(releaseId);
	}
	if (chosen === "text/markdown") {
		if (maintenance) {
			return markdownBody(
				request,
				maintenanceMarkdown(url.origin),
				503,
				releaseId,
			);
		}
		return markdownResponse(request, url, releaseId);
	}
	return null;
}

function markdownResponse(
	request: Request,
	url: URL,
	releaseId: string,
): Response {
	const origin = url.origin;
	const pageKey = normalizePagePath(url.pathname);
	const pageBody = markdownForPath(pageKey, origin);
	const status = pageBody ? 200 : 404;
	const body = pageBody ?? notFoundMarkdown(origin);
	return markdownBody(request, body, status, releaseId);
}

function markdownBody(
	request: Request,
	body: string,
	status: number,
	releaseId: string,
): Response {
	const headers = new Headers({
		"content-type": "text/markdown; charset=utf-8",
		"cache-control": "public, max-age=0, must-revalidate",
		"x-release-id": releaseId,
	});
	appendVaryAccept(headers);
	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, { status, headers });
	}
	return new Response(body, { status, headers });
}

function notAcceptable(releaseId: string): Response {
	const headers = new Headers({
		"content-type": "text/plain; charset=utf-8",
		"x-release-id": releaseId,
	});
	appendVaryAccept(headers);
	return new Response(
		"Not Acceptable. This resource is available as text/html or text/markdown.",
		{
			status: 406,
			headers,
		},
	);
}
