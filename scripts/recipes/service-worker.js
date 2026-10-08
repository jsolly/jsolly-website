// The recipe app's service worker. scripts/recipes/pwa-build.mjs writes it to
// dist/recipes/service-worker.js with three constants prepended: CACHE (this
// snapshot's cache name), PREFIX (every snapshot's cache name prefix) and
// ASSETS (the Set of paths it precaches).
//
// It serves a precached path cache-first, and a page only for a navigation to
// its exact /…/ path (any query or fragment). The lookup ignores Vary as a
// second safeguard (plan §1.13): the precached requests and the lookup are
// bare URLs, so a Vary: Accept response matches today, and it keeps matching
// should either side ever carry a navigation's Accept.
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE).then((store) => store.addAll([...ASSETS])),
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
	if (request.method !== "GET" || url.origin !== self.location.origin) {
		return;
	}
	const key = url.pathname;
	if (!ASSETS.has(key) || (request.mode === "navigate" && !key.endsWith("/"))) {
		return;
	}
	event.respondWith(
		(async () => {
			const store = await caches.open(CACHE);
			return (await store.match(key, { ignoreVary: true })) ?? fetch(request);
		})(),
	);
});
