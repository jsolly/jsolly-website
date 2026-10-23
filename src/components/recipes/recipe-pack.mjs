const RECIPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RELEASE_ID = /^[a-f0-9]{40}$/u;
const packs = new Map();

function releaseMismatch() {
	const error = new Error(
		"This recipe belongs to a different site version. Reload to get the current recipe.",
	);
	error.code = "RECIPE_RELEASE_MISMATCH";
	error.status = 409;
	return error;
}

/** Validate at the fetch boundary before a detail or print view can use a pack. */
export function recipeFromPack(pack, id, releaseId) {
	if (pack?.releaseId !== releaseId) throw releaseMismatch();
	if (
		pack.schemaVersion !== 1 ||
		pack.recipe?.id !== id ||
		!Array.isArray(pack.recipe.ingredients) ||
		!Array.isArray(pack.recipe.familyOptions) ||
		!Array.isArray(pack.recipe.calculation?.rows) ||
		!Array.isArray(pack.recipe.calculation?.nutrients) ||
		!Array.isArray(pack.recipe.calculation?.familyRows)
	)
		throw new Error("The recipe download is incomplete. Try again.");
	return pack.recipe;
}

/** Repeated card prints of one recipe share a request; a failed download is not cached. */
export function loadRecipePack(id, releaseId, { fetcher = fetch } = {}) {
	if (!RECIPE_ID.test(id) || !RELEASE_ID.test(releaseId))
		return Promise.reject(new Error("Invalid recipe download identity."));
	const key = `${releaseId}/${id}`;
	let pending = packs.get(key);
	if (!pending) {
		pending = (async () => {
			const response = await fetcher(`/recipes/data/packs/${id}.json`, {
				headers: { Accept: "application/json", "X-Recipe-Release": releaseId },
				signal: AbortSignal.timeout(15000),
			});
			if (response.status === 409) throw releaseMismatch();
			if (!response.ok)
				throw new Error(
					"The recipe could not be loaded. Check your connection and try again.",
				);
			return recipeFromPack(await response.json(), id, releaseId);
		})();
		packs.set(key, pending);
		pending.catch(() => {
			if (packs.get(key) === pending) packs.delete(key);
		});
	}
	return pending;
}
