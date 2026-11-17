const SAVED_VERSION_NOTICE =
	"This is a saved recipe from an earlier version. Its ingredients and nutrition may differ from the current keto collection. Reconnect and reopen the recipe to check the current version.";
const MAIN_OPEN = /<main\b[^>]*>/iu;

/** Add a notice to the served copy, keeping the stored recipe and runtime intact. */
export async function savedVersionResponse(
	response,
	release,
	currentRelease,
	path,
) {
	if (!response || release === currentRelease || !response.ok) return response;
	const markdown = path.endsWith(".md");
	const html = path.endsWith("/");
	if (!markdown && !html) return response;
	const original = await response.clone().text();
	const body = markdown
		? `> ${SAVED_VERSION_NOTICE}\n\n${original}`
		: original.replace(
				MAIN_OPEN,
				(match) =>
					`${match}<aside role="status" data-saved-recipe-version="older"><p>${SAVED_VERSION_NOTICE}</p></aside>`,
			);
	if (body === original) return response;
	const headers = new Headers(response.headers);
	for (const header of ["content-length", "content-encoding", "etag"])
		headers.delete(header);
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
