// Print all's loading, imported only when it is chosen and importing nothing,
// so the library's startup bundle stays within its budget.

/**
 * Every recipe in `collection`, in the canonical order of `recipes`, whatever
 * the search and filters show. `onMessage` receives the loading progress.
 */
export function loadCollection(
	recipes,
	collection,
	load,
	{ onMessage, signal, concurrency } = {},
) {
	signal?.throwIfAborted();
	const ids = recipes
		.filter((recipe) => recipe.type === collection)
		.map((recipe) => recipe.id);
	const noun = collection === "smoothie" ? "smoothies" : "meals";
	onMessage?.(`Loading ${ids.length} ${noun} for printing…`);
	return loadRecipePacks(ids, load, {
		concurrency,
		signal,
		onProgress: (loaded, total) =>
			onMessage?.(`Loading ${noun} for printing: ${loaded} of ${total}…`),
	});
}

/**
 * Collection printing: `load(id)` for every one of `ids`, in that order, with at most
 * `concurrency` downloads open. The first failure, or an aborted `signal`,
 * rejects and starts no more. `onProgress(loaded, total)` follows each
 * completed download until then, never after.
 */
export async function loadRecipePacks(
	ids,
	load,
	{ concurrency = 6, onProgress, signal } = {},
) {
	const recipes = new Array(ids.length);
	let next = 0;
	let loaded = 0;
	let failed = false;
	async function worker() {
		while (!failed && next < ids.length) {
			signal?.throwIfAborted();
			const index = next++;
			try {
				// biome-ignore lint/performance/noAwaitInLoops: each worker downloads one pack at a time to bound concurrency.
				recipes[index] = await load(ids[index]);
			} catch (error) {
				failed = true;
				throw error;
			}
			if (failed) return;
			signal?.throwIfAborted();
			onProgress?.(++loaded, ids.length);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, ids.length) }, worker),
	);
	return recipes;
}
