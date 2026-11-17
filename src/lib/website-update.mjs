// Repo-owned browser primitives shared by ordinary pages and the recipe app.
const FULL_SHA = /^[a-f0-9]{40}$/u;
const JSON_TYPE = /^application\/json\b/iu;
const DIRTY_COOKING = ".trn-ingredient.checked, .mobile-ingredient.checked";

export const validRelease = (value) =>
	typeof value === "string" && FULL_SHA.test(value);

export async function readRelease(signal) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	const timer = setTimeout(abort, 8_000);
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	try {
		const response = await fetch("/release.json", {
			cache: "no-store",
			credentials: "same-origin",
			signal: controller.signal,
		});
		if (
			!response.ok ||
			response.redirected ||
			new URL(response.url).origin !== location.origin ||
			!JSON_TYPE.test(response.headers.get("content-type") ?? "")
		)
			throw new Error("Release metadata is unavailable");
		const release = await response.json();
		if (!validRelease(release?.sha))
			throw new Error("Invalid release metadata");
		return release.sha;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", abort);
	}
}

// Static Astro navigation owns one controller for the life of each document.
// Suspend in bfcache; remove resources on actual unload. No hidden/offline timer.
export function watchConnectedUpdates(check) {
	let timer;
	let request;
	let stopped = false;
	let suspended = false;
	let nextAttempt = 0;
	let lastAttempt = -Infinity;
	let failures = 0;
	const available = () =>
		!stopped && !suspended && !document.hidden && navigator.onLine;
	const cancel = () => {
		clearTimeout(timer);
		request?.abort();
	};
	const schedule = () => {
		clearTimeout(timer);
		if (available())
			timer = setTimeout(run, Math.max(0, nextAttempt - Date.now()));
	};
	async function run() {
		clearTimeout(timer);
		if (!available() || request) return;
		if (Date.now() < nextAttempt) {
			schedule();
			return;
		}
		const current = new AbortController();
		request = current;
		lastAttempt = Date.now();
		try {
			const success = await check(current.signal);
			if (!current.signal.aborted) failures = success ? 0 : failures + 1;
		} finally {
			request = null;
			const delay = failures
				? Math.min(30 * 60_000, 60_000 * 2 ** Math.min(failures, 5))
				: 5 * 60_000;
			nextAttempt = Date.now() + delay * (0.9 + Math.random() * 0.2);
			schedule();
		}
	}
	const resume = () => {
		if (!available()) {
			cancel();
			return;
		}
		// Explicit foreground events can check after one minute on success;
		// failures retain their longer backoff, preventing reconnect storms.
		if (!failures) nextAttempt = Math.min(nextAttempt, lastAttempt + 60_000);
		schedule();
	};
	const focus = () => {
		if (!failures && !request)
			nextAttempt = Math.min(nextAttempt, lastAttempt + 60_000);
		resume();
	};
	const hide = (event) => {
		suspended = true;
		cancel();
		if (!event.persisted) stop();
	};
	const show = () => {
		suspended = false;
		resume();
	};
	function stop() {
		stopped = true;
		cancel();
		window.removeEventListener("focus", focus);
		window.removeEventListener("online", resume);
		window.removeEventListener("offline", resume);
		document.removeEventListener("visibilitychange", resume);
		window.removeEventListener("pagehide", hide);
		window.removeEventListener("pageshow", show);
	}
	window.addEventListener("focus", focus);
	window.addEventListener("online", resume);
	window.addEventListener("offline", resume);
	document.addEventListener("visibilitychange", resume);
	window.addEventListener("pagehide", hide);
	window.addEventListener("pageshow", show);
	schedule();
	return stop;
}

export function confirmUpdateReload() {
	const dirtyForm = [
		...document.querySelectorAll("form input, form textarea"),
	].some(
		(input) =>
			!input.disabled &&
			!input.readOnly &&
			!["hidden", "submit", "button", "checkbox", "radio"].includes(
				input.type,
			) &&
			input.value !== input.defaultValue,
	);
	return (
		!(dirtyForm || document.querySelector(DIRTY_COOKING)) ||
		// biome-ignore lint/suspicious/noAlert: native confirmation protects actual unsaved work before a requested reload.
		window.confirm(
			"Reload this tab and discard unsaved cooking checks or form changes? Saved recipe preferences will be kept.",
		)
	);
}

export function staleUpdateAttempt(lane, loaded) {
	try {
		const key = `website-update-${lane}`;
		const attempt = JSON.parse(sessionStorage.getItem(key) ?? "null");
		if (
			validRelease(attempt?.from) &&
			validRelease(attempt?.target) &&
			attempt.from === loaded &&
			attempt.target !== loaded
		)
			return attempt.target;
		sessionStorage.removeItem(key);
	} catch {
		/* Storage may be disabled; detection still uses the embedded ID. */
	}
	return null;
}

export function reloadForUpdate(lane, from, target) {
	try {
		sessionStorage.setItem(
			`website-update-${lane}`,
			JSON.stringify({ from, target }),
		);
	} catch {
		/* A failed storage write must not clear unrelated user state. */
	}
	location.reload();
}
