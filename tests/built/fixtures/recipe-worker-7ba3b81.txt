import {
	markdownSiblingPath,
	preferredType,
} from "../../src/lib/accept-negotiate.js";

// The recipe app's service worker. scripts/recipes/pwa-build.mjs writes it to
// dist/recipes/service-worker.js with three constants prepended: CACHE (this
// snapshot's cache name), PREFIX (every snapshot's cache name prefix) and
// ASSETS (the Set of paths it precaches).
//
// HTML and Markdown have separate snapshot keys and explicit Accept headers.
// Both lookup and precaching use those headers, including with Vary: Accept.
function snapshotRequest(path) {
	return new Request(new URL(path, self.location.origin), {
		headers: {
			accept: path.endsWith("/")
				? "text/html"
				: path.endsWith(".md")
					? "text/markdown"
					: "*/*",
		},
	});
}
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((store) => store.addAll([...ASSETS].map(snapshotRequest))),
	);
});

// The new snapshot takes over once every recipe tab has closed; older
// snapshots' caches go then.
self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const stale = (await caches.keys()).filter(
				(key) => key.startsWith(PREFIX) && key !== CACHE,
			);
			await Promise.all(stale.map((key) => caches.delete(key)));
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (
		!["GET", "HEAD"].includes(request.method) ||
		url.origin !== self.location.origin
	) {
		return;
	}
	let key = url.pathname;
	if (!ASSETS.has(key)) return;
	if (key.endsWith("/")) {
		const chosen = preferredType(request.headers.get("accept"));
		if (chosen === null) {
			event.respondWith(
				new Response(
					request.method === "HEAD"
						? null
						: "Not Acceptable. This resource is available as text/html or text/markdown.",
					{
						status: 406,
						headers: {
							"content-type": "text/plain; charset=utf-8",
							vary: "Accept",
						},
					},
				),
			);
			return;
		}
		if (chosen === "text/markdown") key = markdownSiblingPath(key);
	}
	if (
		!ASSETS.has(key) ||
		(request.mode === "navigate" && !key.endsWith("/") && !key.endsWith(".md"))
	) {
		return;
	}
	event.respondWith(
		(async () => {
			const store = await caches.open(CACHE);
			const cached = await store.match(snapshotRequest(key));
			if (!cached) return fetch(request);
			return request.method === "HEAD"
				? new Response(null, {
						status: cached.status,
						statusText: cached.statusText,
						headers: cached.headers,
					})
				: cached;
		})(),
	);
});
