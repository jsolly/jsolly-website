// biome-ignore-all lint/suspicious/noUnnecessaryConditions: browser event callbacks mutate lifecycle flags after initialization.
import { reportError } from "../../lib/report-error.mjs";
import {
	confirmUpdateReload,
	reloadForUpdate,
	staleUpdateAttempt,
	validRelease,
	watchConnectedUpdates,
} from "../../lib/website-update.mjs";
import { PWA_WORKER_PATH, RECIPES_PATH } from "./constants.mjs";
import { withRecipeActivation } from "./recipe-browse-coordination.mjs";

const status = document.querySelector("#recipe-offline-status");
const action = document.querySelector("#recipe-update-action");
const button = document.querySelector("#recipe-update-button");
const later = document.querySelector("#recipe-update-later");
const reopen = document.querySelector("#recipe-update-reopen");
const show = document.querySelector("#recipe-update-show");
const instructions = status?.textContent ?? "";
const loadedRelease = document.querySelector("#site-update-notice")?.dataset
	.release;
let registration;
let observed;
let refreshSequence = 0;
let applying = false;
let availableRelease = staleUpdateAttempt("recipes", loadedRelease);
let dismissedRelease = null;
let problem = availableRelease
	? "This tab still has an older version. Try Update and reload again."
	: "";
const state = {
	active: false,
	waiting: false,
	failed: false,
	checkFailed: false,
	online: navigator.onLine,
};
const hasActive = () => registration?.active?.state === "activated";

function message() {
	if (applying) return "Applying recipe update…";
	if (problem) return problem;
	if (availableRelease && state.checkFailed)
		return "Could not verify the recipe update. Saved recipes remain available. Try Update and reload again.";
	if (availableRelease)
		return state.waiting
			? "Update available. The updated app is ready. Your saved recipes stay available."
			: "Recipes were updated in another tab. Reload when you are ready.";
	if (!state.active)
		return state.failed
			? `Recipes could not be saved offline. Reconnect and reload to try again. ${instructions}`
			: instructions;
	if (state.failed)
		return "Update download failed. Previously saved recipes remain available offline. Reconnect and reload to retry the update.";
	if (state.checkFailed)
		return "Could not check for recipe updates. Saved recipes remain available. Reconnect and try again.";
	return state.online
		? `Opened recipes can be saved for offline use. ${instructions}`
		: "You are offline. Open Saved recipes to find recipes available on this device. External links need a connection.";
}
function render() {
	const text = message();
	if (
		status.textContent !== text ||
		status.dataset.target !== (availableRelease ?? "")
	) {
		status.textContent = text;
		status.dataset.target = availableRelease ?? "";
	}
	const collapsed =
		availableRelease !== null && dismissedRelease === availableRelease;
	action.hidden = !availableRelease || collapsed;
	reopen.hidden = !availableRelease || !collapsed;
	button.disabled = applying;
	later.disabled = applying;
	status.closest(".recipe-pwa").hidden =
		state.online &&
		!availableRelease &&
		!problem &&
		!state.failed &&
		!state.checkFailed;
}
function version(worker) {
	return new Promise((resolve, reject) => {
		if (
			!worker ||
			worker.scriptURL !== new URL(PWA_WORKER_PATH, location.origin).href
		) {
			reject(new Error("Unexpected recipe worker"));
			return;
		}
		const channel = new MessageChannel();
		const finish = (error, release) => {
			clearTimeout(timer);
			channel.port1.close();
			channel.port2.close();
			if (error) reject(error);
			else resolve(release);
		};
		const timer = setTimeout(
			() => finish(new Error("Recipe version handshake timed out")),
			5_000,
		);
		channel.port1.onmessage = (event) => {
			if (!validRelease(event.data?.release))
				finish(new Error("Invalid recipe worker identity"));
			else finish(null, event.data.release);
		};
		try {
			worker.postMessage({ type: "RECIPE_VERSION" }, [channel.port2]);
		} catch (error) {
			finish(error);
		}
	});
}
function ready() {
	navigator.serviceWorker.controller?.postMessage({
		type: "RECIPE_CLIENT_READY",
		release: loadedRelease,
	});
}
async function refresh() {
	const sequence = ++refreshSequence;
	const waiting = registration.waiting;
	const controller = navigator.serviceWorker.controller;
	let next = null;
	try {
		if (waiting) {
			const release = await version(waiting);
			if (waiting !== registration.waiting) return true;
			if (release !== loadedRelease || (controller && controller !== waiting))
				next = { worker: waiting, release, waiting: true };
		} else if (controller) {
			// A legacy worker without the handshake remains usable, but cannot
			// establish an update identity. Preserve any confirmed target on failure.
			const release = await version(controller);
			if (controller !== navigator.serviceWorker.controller) return true;
			if (release !== loadedRelease)
				next = { worker: controller, release, waiting: false };
		}
	} catch (error) {
		if (
			sequence !== refreshSequence ||
			applying ||
			waiting !== registration.waiting ||
			(!waiting && controller !== navigator.serviceWorker.controller)
		)
			return true;
		reportCheckFailure(error);
		return false;
	}
	if (sequence !== refreshSequence || applying) return true;
	state.checkFailed = false;
	if (next?.release !== availableRelease && next) problem = "";
	availableRelease = next?.release ?? null;
	state.waiting = Boolean(next?.waiting);
	state.active = hasActive();
	ready();
	render();
	return true;
}
function reportCheckFailure(error) {
	state.checkFailed = true;
	void reportError("recipe-update");
	console.error("Recipe update check failed:", error);
	render();
}
function observeInstaller() {
	const worker = registration.installing;
	if (!worker || observed === worker) return;
	observed = worker;
	state.failed = false;
	state.checkFailed = false;
	let installed = false;
	worker.addEventListener("statechange", () => {
		if (worker.state === "installed") installed = true;
		if (worker.state === "redundant" && !installed) {
			state.failed = true;
			void reportError("recipe-update");
			console.error(
				hasActive()
					? "Recipe update download failed:"
					: "Recipe offline download failed:",
				worker.scriptURL,
			);
		}
		state.active = hasActive();
		render();
		void refresh().catch(reportCheckFailure);
	});
}
function activateAndWait(worker, release) {
	return new Promise((resolve, reject) => {
		const initial = navigator.serviceWorker.controller;
		let settled = false;
		let checking = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			navigator.serviceWorker.removeEventListener("controllerchange", check);
			worker.removeEventListener("statechange", check);
			if (error) reject(error);
			else resolve();
		};
		async function check() {
			const controller = navigator.serviceWorker.controller;
			if (controller !== worker) {
				if (controller !== initial)
					finish(new Error("A different recipe worker took control"));
				return;
			}
			if (checking || settled || controller.state !== "activated") return;
			checking = true;
			try {
				if ((await version(controller)) !== release)
					throw new Error("Recipe controller identity changed");
				finish();
			} catch (error) {
				finish(error);
			}
		}
		const timer = setTimeout(
			() => finish(new Error("Recipe activation timed out")),
			15_000,
		);
		navigator.serviceWorker.addEventListener("controllerchange", check);
		worker.addEventListener("statechange", check);
		void check();
		if (navigator.serviceWorker.controller !== worker) {
			try {
				worker.postMessage({ type: "ACTIVATE_RECIPE_UPDATE", release });
			} catch (error) {
				finish(error);
			}
		}
	});
}
async function register() {
	registration = await navigator.serviceWorker.register(PWA_WORKER_PATH, {
		scope: RECIPES_PATH,
		updateViaCache: "none",
	});
	if (!registration) return; // Playwright's blocked-worker registration shim.
	if (registration.scope !== new URL(RECIPES_PATH, location.origin).href)
		throw new Error("Unexpected recipe scope");
	state.active = hasActive();
	// Readiness belongs to the loaded document, including an offline reload;
	// online polling must not delay releasing this client's previous snapshot.
	ready();

	observeInstaller();
	registration.addEventListener("updatefound", observeInstaller);
	render();
	// Discover already-downloaded workers even when this document starts offline.
	void refresh().catch(reportCheckFailure);
	let startup = true;
	watchConnectedUpdates(async (signal) => {
		let timer;
		try {
			if (startup) {
				startup = false;
				return true; // register() already performs the startup network check.
			}
			await Promise.race([
				registration.update(),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Recipe update check timed out")),
						8_000,
					);
				}),
			]);
			if (signal.aborted) return false;
			state.checkFailed = false;
			return await refresh();
		} catch (error) {
			if (!signal.aborted) reportCheckFailure(error);
			return false;
		} finally {
			clearTimeout(timer);
		}
	});
}
if (status) {
	later.addEventListener("click", () => {
		dismissedRelease = availableRelease;
		render();
		show.focus();
	});
	show.addEventListener("click", () => {
		dismissedRelease = null;
		render();
		button.focus();
	});
	button.addEventListener("click", async () => {
		if (applying || !availableRelease) return;
		if (!confirmUpdateReload()) {
			button.focus();
			return;
		}
		applying = true;
		problem = "";
		render();
		try {
			const activatedRelease = await withRecipeActivation(async () => {
				const current =
					await navigator.serviceWorker.getRegistration(RECIPES_PATH);
				if (
					!current ||
					current.scope !== new URL(RECIPES_PATH, location.origin).href
				)
					throw new Error("Recipe registration disappeared");
				const worker = current.waiting ?? navigator.serviceWorker.controller;
				const release = await version(worker);
				if (release !== availableRelease) {
					availableRelease = release === loadedRelease ? null : release;
					problem =
						"A different recipe update is now available. Choose Update and reload again when ready.";
					return null;
				}
				if (current.waiting === worker) {
					if (worker.state !== "installed")
						throw new Error("Recipe update is not fully installed");
					await activateAndWait(worker, release);
				} else if (
					navigator.serviceWorker.controller !== worker ||
					worker.state !== "activated"
				)
					throw new Error("Recipe controller changed");
				return release;
			});
			if (activatedRelease)
				reloadForUpdate("recipes", loadedRelease, activatedRelease);
		} catch (error) {
			problem =
				"The recipe update could not be applied. Try Update and reload again.";
			void reportError("recipe-update");
			console.error("Recipe update activation failed:", error);
		} finally {
			applying = false;
			render();
		}
	});
	if ("serviceWorker" in navigator)
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			ready();
			if (registration) void refresh().catch(reportCheckFailure);
		});
	for (const event of ["online", "offline"])
		window.addEventListener(event, () => {
			state.online = navigator.onLine;
			render();
		});
	render();
	if (!import.meta.env.DEV && "serviceWorker" in navigator)
		void register().catch((error) => {
			state.failed = true;
			void reportError("recipe-update");
			console.error("Recipe service worker registration failed:", error);
			render();
		});
}
