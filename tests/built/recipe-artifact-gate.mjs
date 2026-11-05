/** Hold one real immutable artifact body while the browser keeps its current cards. */
export async function holdRecipeArtifact(page, directory) {
	const started = Promise.withResolvers();
	const released = Promise.withResolvers();
	const finished = Promise.withResolvers();
	page.once("close", () => released.resolve());
	let claimed = false;
	// Keep routing active until the page closes. Removing a one-shot route while
	// fulfilling it can strand the dynamic imports triggered by that response.
	await page.route(
		(url) => url.pathname.startsWith(`/recipes/data/${directory}/`),
		async (route) => {
			if (claimed) return route.fallback();
			claimed = true;
			try {
				const response = await route.fetch();
				started.resolve({ url: route.request().url(), response });
				await released.promise;
				await route.fulfill({ response });
				finished.resolve();
			} catch (error) {
				started.reject(error);
				if (page.isClosed()) finished.resolve();
				else finished.reject(error);
			}
		},
	);
	return {
		started: started.promise,
		finished: finished.promise,
		release: () => released.resolve(),
	};
}
