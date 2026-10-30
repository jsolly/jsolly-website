/** Hold one real immutable artifact body while the browser keeps its current cards. */
export async function holdRecipeArtifact(page, directory) {
	const started = Promise.withResolvers();
	const released = Promise.withResolvers();
	const finished = Promise.withResolvers();
	page.once("close", () => released.resolve());
	await page.route(
		(url) => url.pathname.startsWith(`/recipes/data/${directory}/`),
		async (route) => {
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
		{ times: 1 },
	);
	return {
		started: started.promise,
		finished: finished.promise,
		release: () => released.resolve(),
	};
}
