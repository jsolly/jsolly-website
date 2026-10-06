import { PWA_WORKER_PATH, RECIPES_PATH } from "./constants.mjs";

// Registers the recipe app's service worker on every recipe page and reports
// its state in RecipePwa's status line. The worker controls /recipes/ only.
// An update waits for every recipe tab to close (scripts/recipes/pwa-build.mjs).
const status = document.querySelector("#recipe-offline-status");
const instructions = status?.textContent ?? "";
// `active`: a worker holds an offline copy; `waiting`: an update is
// downloaded; `failed`: the first download, or with `active` an update,
// failed; `online` mirrors navigator.onLine.
const state = {
	active: false,
	waiting: false,
	failed: false,
	online: navigator.onLine,
};

// The status line for `state`.
function message({ active, waiting, failed, online }) {
	if (!active) {
		return failed
			? `Recipes could not be saved offline. Reconnect and reload to try again. ${instructions}`
			: instructions;
	}
	if (waiting) {
		return "Updated recipes are downloaded. Close all recipe tabs and the recipe app, then reopen to use the update.";
	}
	if (failed) {
		return "Update download failed. Previously saved recipes remain available offline. Reconnect and reload to retry the update.";
	}
	return online
		? `Recipes saved for offline use. ${instructions}`
		: "You are offline. Saved recipes, scaling and grocery lists are available. External links need a connection.";
}

function render() {
	status.textContent = message(state);
}

// Whether `registration` has an activated worker, one with an offline copy.
const hasActive = (registration) => registration.active?.state === "activated";

// Follows the worker `registration` is installing, the first one or an
// update. One that turns redundant before it installed failed to download;
// a later redundant state only means a newer worker replaced it. Both
// register() and updatefound may report the same worker; it is followed once.
let observed = null;
function observeInstaller(registration) {
	const worker = registration.installing;
	if (!worker || worker === observed) return;
	observed = worker;
	state.failed = false;
	let installed = false;
	worker.addEventListener("statechange", () => {
		if (worker.state === "installed") installed = true;
		if (worker.state === "redundant" && !installed) {
			state.failed = true;
			console.error(
				hasActive(registration)
					? "Recipe update download failed:"
					: "Recipe offline download failed:",
				worker.scriptURL,
			);
		}
		state.active = hasActive(registration);
		state.waiting = Boolean(registration.waiting);
		render();
	});
}

async function register() {
	const registration = await navigator.serviceWorker.register(PWA_WORKER_PATH, {
		scope: RECIPES_PATH,
		updateViaCache: "none",
	});
	state.active = hasActive(registration);
	state.waiting = Boolean(registration.waiting);
	observeInstaller(registration);
	registration.addEventListener("updatefound", () =>
		observeInstaller(registration),
	);
	render();
}

if (!import.meta.env.DEV && "serviceWorker" in navigator && status) {
	for (const event of ["online", "offline"]) {
		window.addEventListener(event, () => {
			state.online = navigator.onLine;
			render();
		});
	}
	register().catch((error) => {
		state.failed = true;
		console.error("Recipe service worker registration failed:", error);
		render();
	});
}
