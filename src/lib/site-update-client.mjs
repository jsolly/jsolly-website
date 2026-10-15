import {
	confirmUpdateReload,
	readRelease,
	reloadForUpdate,
	staleUpdateAttempt,
	watchConnectedUpdates,
} from "./website-update.mjs";

const notice = document.querySelector("#site-update-notice");
if (notice) {
	const loaded = notice.dataset.release;
	const details = document.querySelector("#site-update-details");
	const reopen = document.querySelector("#site-update-reopen");
	const button = document.querySelector("#site-update-button");
	const later = document.querySelector("#site-update-later");
	const show = document.querySelector("#site-update-show");
	// biome-ignore lint/security/noSecrets: selector for the live status, not secret material.
	const status = notice.querySelector('[role="status"]');
	const controlled = () => Boolean(navigator.serviceWorker?.controller);
	let detected = controlled() ? null : staleUpdateAttempt("site", loaded);
	let dismissed = null;
	let applying = false;
	let sequence = 0;
	let problem = detected
		? "This tab still has an older version. Try Update and reload again."
		: "";
	function render() {
		notice.hidden = controlled() || !detected;
		const text =
			problem || "Update available. A new version of this website is ready.";
		if (
			status.textContent !== text ||
			status.dataset.target !== (detected ?? "")
		)
			status.textContent = text;
		status.dataset.target = detected ?? "";
		details.hidden = dismissed === detected;
		reopen.hidden = dismissed !== detected;
		button.disabled = applying;
		later.disabled = applying;
	}
	later.addEventListener("click", () => {
		dismissed = detected;
		render();
		show.focus();
	});
	show.addEventListener("click", () => {
		dismissed = null;
		render();
		button.focus();
	});
	watchConnectedUpdates(async (signal) => {
		if (controlled() || applying) {
			render();
			return true;
		}
		const observation = ++sequence;
		try {
			const release = await readRelease(signal);
			if (
				signal.aborted ||
				controlled() ||
				applying ||
				observation !== sequence
			)
				return true;
			if (release !== loaded && release !== detected) {
				detected = release;
				problem = "";
			} else if (release === loaded) {
				detected = null;
				problem = "";
			}
			render();
			return true;
		} catch {
			return false;
		}
	});
	button.addEventListener("click", async () => {
		if (applying || controlled()) return;
		if (!confirmUpdateReload()) {
			button.focus();
			return;
		}
		applying = true;
		sequence++;
		render();
		try {
			if (!navigator.onLine) throw new Error("Offline");
			const current = await readRelease();
			if (controlled()) return;
			if (current === loaded) {
				detected = null;
				problem = "";
				return;
			}
			if (current !== detected) {
				detected = current;
				problem =
					"A different update is now available. Choose Update and reload again when ready.";
				return;
			}
			reloadForUpdate("site", loaded, current);
		} catch {
			problem =
				"Could not check the update. Reconnect and try Update and reload again.";
		} finally {
			applying = false;
			render();
		}
	});
	navigator.serviceWorker?.addEventListener("controllerchange", render);
	render();
}
