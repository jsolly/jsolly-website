import {
	maintenanceMarkdown,
	markdownForPath,
	notFoundMarkdown,
} from "../content/agent-pages.js";
import {
	appendVaryAccept,
	isStaticDataPath,
	normalizePagePath,
	preferredType,
	shouldNegotiate,
	TRAILING_SLASHES_RE,
} from "./accept-negotiate.js";

/**
 * Markdown / 406 response, or null to fall through to HTML or the static file.
 * `routes` is the build's route manifest (see middleware.ts); tests inject it.
 */
export function agentResponse(
	request: Request,
	routes: ReadonlySet<string>,
): Response | null {
	const url = new URL(request.url);
	const maintenance = process.env.MAINTENANCE_MODE === "true";

	const pathNoSlash = url.pathname.replace(TRAILING_SLASHES_RE, "") || "/";
	if (pathNoSlash.toLowerCase().endsWith(".md")) {
		if (isStaticDataPath(url.pathname)) return null;
		if (maintenance) {
			return markdownBody(request, maintenanceMarkdown(url.origin), 503);
		}
		return markdownResponse(request, url);
	}

	if (!shouldNegotiate(url.pathname, request.method, routes)) {
		return null;
	}

	const chosen = preferredType(request.headers.get("accept"));
	if (chosen === null) {
		return notAcceptable();
	}
	if (chosen === "text/markdown") {
		if (maintenance) {
			return markdownBody(request, maintenanceMarkdown(url.origin), 503);
		}
		return markdownResponse(request, url);
	}
	return null;
}

function markdownResponse(request: Request, url: URL): Response {
	const origin = url.origin;
	const pageKey = normalizePagePath(url.pathname);
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
	const headers = new Headers({
		"content-type": "text/markdown; charset=utf-8",
		"cache-control": "public, max-age=0, must-revalidate",
	});
	appendVaryAccept(headers);
	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, { status, headers });
	}
	return new Response(body, { status, headers });
}

function notAcceptable(): Response {
	const headers = new Headers({
		"content-type": "text/plain; charset=utf-8",
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
