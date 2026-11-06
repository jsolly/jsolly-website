import type { Page } from "playwright";

interface ReleaseObserver {
	started: number;
	pending: number;
	waiters: Array<() => void>;
}

declare global {
	interface Window {
		__releaseObserver: ReleaseObserver;
	}
}

/** Observe native completion without advancing the page's clock or changing values. */
export async function observeReleaseChecks(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const observer: ReleaseObserver = { started: 0, pending: 0, waiters: [] };
		window.__releaseObserver = observer;
		const nativeFetch = window.fetch;
		window.fetch = async (...args: Parameters<typeof fetch>) => {
			const input = args[0];
			const url = input instanceof Request ? input.url : String(input);
			if (new URL(url, location.href).pathname !== "/release.json")
				return await nativeFetch(...args);
			observer.started++;
			observer.pending++;
			let parsing = false;
			let completed = false;
			const complete = () => {
				// A task follows the native promise's entire microtask checkpoint,
				// including readRelease and watchConnectedUpdates finally blocks.
				const channel = new MessageChannel();
				channel.port1.onmessage = () => {
					channel.port1.close();
					channel.port2.close();
					if (completed) return;
					completed = true;
					observer.pending--;
					if (observer.pending === 0)
						for (const resolve of observer.waiters.splice(0)) resolve();
				};
				channel.port2.postMessage(null);
			};
			try {
				const response = await nativeFetch(...args);
				const nativeJson = response.json.bind(response);
				response.json = async () => {
					parsing = true;
					try {
						return await nativeJson();
					} finally {
						complete();
					}
				};
				// Invalid HTTP/MIME/redirect responses are rejected before json().
				const channel = new MessageChannel();
				channel.port1.onmessage = () => {
					channel.port1.close();
					channel.port2.close();
					if (!parsing) complete();
				};
				channel.port2.postMessage(null);
				return response;
			} catch (error) {
				complete();
				throw error;
			}
		};
	});
}

/** Initial startup must also have checked before a fixture changes fake time. */
export async function waitForReleaseChecks(page: Page): Promise<void> {
	await page.waitForFunction(() => window.__releaseObserver.started > 0);
	await page.evaluate(async () => {
		const observer = window.__releaseObserver;
		if (observer.pending > 0)
			await new Promise<void>((resolve) => observer.waiters.push(resolve));
	});
}
