import { PWA_WORKER_PATH, RECIPES_PATH } from "./constants.mjs";

// Registers the recipe app's service worker on every recipe page and reports
// its state in RecipePwa's status line. The worker controls /recipes/ only.
// An update waits for every recipe tab to close (scripts/recipes/pwa-build.mjs).
const UPDATE_READY =
	"Updated recipes are downloaded. Close all recipe tabs and the recipe app, then reopen to use the update.";
const UPDATE_FAILED =
	"Update download failed. Previously saved recipes remain available offline. Reconnect and reload to retry the update.";
const OFFLINE =
	"You are offline. Saved recipes, scaling and grocery lists are available. External links need a connection.";

const status = document.querySelector("#recipe-offline-status");
const instructions = status?.textContent ?? "";

// Resolves once `worker` activates; rejects when its install fails.
function activation(worker) {
	return new Promise((resolve, reject) => {
		const check = () => {
			if (worker.state === "activated") resolve();
			if (worker.state === "redundant") {
				reject(new Error("Offline download failed"));
			}
		};
		worker.addEventListener("statechange", check);
		check();
	});
}

async function register() {
	const registration = await navigator.serviceWorker.register(PWA_WORKER_PATH, {
		scope: RECIPES_PATH,
		updateViaCache: "none",
	});
	const observeInstaller = () => {
		const worker = registration.installing;
		if (!worker) return;
		worker.addEventListener("statechange", () => {
			if (registration.waiting) {
				status.textContent = UPDATE_READY;
			} else if (worker.state === "redundant" && registration.active) {
				status.textContent = UPDATE_FAILED;
			}
		});
	};
	observeInstaller();
	registration.addEventListener("updatefound", observeInstaller);
	if (!registration.active && registration.installing) {
		await activation(registration.installing);
	}
	const showReady = () => {
		status.textContent = navigator.onLine
			? `Recipes saved for offline use. ${instructions}`
			: OFFLINE;
	};
	showReady();
	window.addEventListener("online", showReady);
	window.addEventListener("offline", showReady);
	if (registration.waiting) status.textContent = UPDATE_READY;
}

if (!import.meta.env.DEV && "serviceWorker" in navigator && status) {
	register().catch(() => {
		status.textContent = `Recipes could not be saved offline. Reconnect and reload to try again. ${instructions}`;
	});
}
