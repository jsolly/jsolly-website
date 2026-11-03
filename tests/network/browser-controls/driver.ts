import type { BrowserOperation } from "./types.ts";
/** Physical typed source serialized by Playwright, with no Node dependencies. */
export async function browserOperation({
	channel,
	target,
}: BrowserOperation): Promise<boolean> {
	if (channel === "dedicated" || channel === "shared") {
		const script = `/${channel}.js?target=${encodeURIComponent(target)}`;
		return await new Promise<boolean>((resolve, reject) => {
			if (channel === "dedicated") {
				const worker = new Worker(script);
				worker.onmessage = (event) => {
					worker.terminate();
					resolve(event.data === "sentinel");
				};
				worker.onerror = () => {
					worker.terminate();
					reject(new Error("Dedicated worker bootstrap failed"));
				};
			} else {
				const worker = new SharedWorker(script);
				worker.port.onmessage = (event) => {
					worker.port.close();
					resolve(event.data === "sentinel");
				};
				worker.onerror = () => {
					worker.port.close();
					reject(new Error("Shared worker bootstrap failed"));
				};
				worker.port.start();
			}
		});
	}
	if (channel === "ws" || channel === "wss") {
		return await new Promise<boolean>((resolve) => {
			const socket = new WebSocket(target);
			socket.onmessage = (event) => {
				socket.close();
				resolve(event.data === "sentinel");
			};
			socket.onerror = () => {
				socket.close();
				resolve(false);
			};
		});
	}
	if (channel.startsWith("sw-")) {
		const mode = channel.slice(3);
		const script = `/service.js?mode=${mode}&target=${encodeURIComponent(target)}`;
		let registration: ServiceWorkerRegistration;
		try {
			registration = await navigator.serviceWorker.register(script, {
				scope: "/",
			});
		} catch {
			return false;
		}
		try {
			const settled = async (
				worker: ServiceWorker | null,
			): Promise<boolean> => {
				if (!worker) return false;
				return await new Promise<boolean>((resolve) => {
					const check = () => {
						if (worker.state === "activated") resolve(true);
						if (worker.state === "redundant") resolve(false);
					};
					worker.addEventListener("statechange", check);
					check();
				});
			};
			if (
				!(await settled(
					registration.installing ??
						registration.waiting ??
						registration.active,
				))
			)
				return false;
			if (channel === "sw-update") {
				// Server changes only the compiled revision, never the registration URL.
				await fetch("/advance-service-revision");
				const found = new Promise<ServiceWorker>((resolve) =>
					registration.addEventListener(
						"updatefound",
						() => {
							if (registration.installing) resolve(registration.installing);
						},
						{ once: true },
					),
				);
				await registration.update();
				return await settled(await found);
			}
			if (channel === "sw-fetch") {
				if (!navigator.serviceWorker.controller)
					await new Promise<void>((resolve) =>
						navigator.serviceWorker.addEventListener(
							"controllerchange",
							() => resolve(),
							{ once: true },
						),
					);
				try {
					return (
						(await (await fetch("/through-service-worker")).text()) ===
						"sentinel"
					);
				} catch {
					return false;
				}
			}
			return true;
		} finally {
			await registration.unregister();
		}
	}
	throw new Error(`Unsupported browser operation ${channel}`);
}
