import { reportError } from "../../lib/report-error.mjs";
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

// A legacy blogthedata.com /recipes/#<recipe-id> link replaces its library
// entry with the recipe page, so that page's Back must not traverse history,
// which would leave the site. The library marks the redirect for the page.
const LEGACY_REDIRECT_KEY = "recipes-legacy-redirect";

export function markLegacyRedirect(id, getStorage = () => sessionStorage) {
	try {
		getStorage().setItem(LEGACY_REDIRECT_KEY, id);
	} catch (error) {
		void reportError("recipe-storage-write");
		console.error(
			"The legacy recipe link could not be recorded; Back may leave the site.",
			error instanceof Error ? error.name : "Unknown error",
		);
	}
}

/** Consumes the library's mark for this recipe; true when the page was redirected to. */
export function takeLegacyRedirect(id, getStorage = () => sessionStorage) {
	try {
		const storage = getStorage();
		if (storage.getItem(LEGACY_REDIRECT_KEY) !== id) return false;
		storage.removeItem(LEGACY_REDIRECT_KEY);
		return true;
	} catch (error) {
		void reportError("recipe-storage-read");
		console.error(
			"The legacy recipe link could not be read; Back uses browser history.",
			error instanceof Error ? error.name : "Unknown error",
		);
		return false;
	}
}

/** An ordinary library visit drops a mark whose redirect never reached its page. */
export function clearLegacyRedirect(getStorage = () => sessionStorage) {
	try {
		getStorage().removeItem(LEGACY_REDIRECT_KEY);
	} catch (error) {
		void reportError("recipe-storage-write");
		console.error(
			"A stale legacy recipe link could not be cleared; a later Back may follow its collection link.",
			error instanceof Error ? error.name : "Unknown error",
		);
	}
}
