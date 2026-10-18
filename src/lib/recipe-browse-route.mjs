const COLLECTIONS = new Set([
	"/recipes/",
	"/recipes/meals/",
	"/recipes/smoothies/",
]);

/** Explicit native GET submissions only; Markdown negotiation runs before this. */
export function recipeBrowseDestination(request) {
	const url = new URL(request.url);
	if (
		!["GET", "HEAD"].includes(request.method) ||
		!COLLECTIONS.has(url.pathname) ||
		url.searchParams.get("browse") !== "1"
	)
		return null;
	const destination = new URL("/api/recipe-browse/", url);
	destination.search = url.search;
	destination.searchParams.set("path", url.pathname);
	return destination;
}
