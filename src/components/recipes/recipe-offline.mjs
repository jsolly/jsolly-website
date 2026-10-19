// These APIs run only on explicit recipe opens or individual print requests.
// They never save a recipe while rendering a card, scrolling or hovering it.
async function request(message) {
	if (!("serviceWorker" in navigator))
		throw new Error("Offline storage is unavailable in this browser.");
	let readyTimer;
	const registration = await Promise.race([
		navigator.serviceWorker.ready,
		new Promise((_, reject) => {
			readyTimer = setTimeout(
				() =>
					reject(
						new Error(
							"Offline storage is not ready. Reconnect and reopen the recipe.",
						),
					),
				20_000,
			);
		}),
	]).finally(() => clearTimeout(readyTimer));
	const worker = navigator.serviceWorker.controller ?? registration.active;
	if (!worker) throw new Error("Offline storage is not ready.");
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		const finish = (error, value) => {
			clearTimeout(timer);
			channel.port1.close();
			channel.port2.close();
			if (error) reject(error);
			else resolve(value);
		};
		const timer = setTimeout(
			() =>
				finish(
					new Error(
						"Saving this recipe took too long. Reconnect and reopen it to retry.",
					),
				),
			60_000,
		);
		channel.port1.onmessage = ({ data }) =>
			data.error ? finish(new Error(data.error)) : finish(null, data);
		try {
			worker.postMessage(message, [channel.port2]);
		} catch (error) {
			finish(error);
		}
	});
}
export async function saveRecipeOffline(
	id,
	release = document.querySelector("#site-update-notice")?.dataset.release,
) {
	const result = await request({ type: "SAVE_RECIPE", id, release });
	window.dispatchEvent(new CustomEvent("recipe-saved", { detail: result }));
	return result;
}
export async function listSavedRecipes() {
	return (await request({ type: "LIST_SAVED_RECIPES" })).recipes;
}
