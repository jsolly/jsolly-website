import { RECIPE_BATCH_SIZE } from "./constants.mjs";

const COLLECTION_PATHS = new Set([
	"/recipes/",
	"/recipes/meals/",
	"/recipes/smoothies/",
	"/recipes/saved/",
]);

// Browser history owns return points, so unrelated visits and tabs cannot reuse
// a stale global scroll position. Only same-origin collection URLs are accepted.
export function collectionReturn(state, referrer, currentUrl, collection) {
	for (const candidate of [state?.recipeReturn, referrer]) {
		if (typeof candidate !== "string" || !candidate) continue;
		let url;
		try {
			url = new URL(candidate, currentUrl);
		} catch {
			continue;
		}
		if (
			url.origin === currentUrl.origin &&
			COLLECTION_PATHS.has(url.pathname) &&
			(url.pathname === "/recipes/" ||
				url.pathname === "/recipes/saved/" ||
				url.pathname === `/recipes/${collection}/`)
		) {
			return `${url.pathname}${url.search}${url.hash}`;
		}
	}
	return "";
}

export function listVisit(state, recipes) {
	const saved = state?.recipeList;
	if (
		!saved ||
		typeof saved !== "object" ||
		!Number.isFinite(saved.scrollY) ||
		saved.scrollY < 0
	)
		return null;
	const ids = new Set(recipes.map((recipe) => recipe.id));
	const order =
		Array.isArray(saved.order) &&
		saved.order.length === ids.size &&
		new Set(saved.order).size === ids.size &&
		saved.order.every((id) => ids.has(id))
			? saved.order
			: null;
	return {
		scrollY: saved.scrollY,
		query: typeof saved.query === "string" ? saved.query : "",
		order,
		limit:
			Number.isSafeInteger(saved.limit) &&
			saved.limit >= RECIPE_BATCH_SIZE &&
			saved.limit <= Math.max(RECIPE_BATCH_SIZE, recipes.length)
				? saved.limit
				: RECIPE_BATCH_SIZE,
	};
}
