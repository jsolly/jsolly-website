// Kill-switch for the retired blogthedata.com recipe service workers. The old
// cache-first workers were registered at /recipe-service-worker.js (scope /) and
// at /post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js (scope
// that post). A browser's update check fetches this file in their place. It
// takes over, deletes every cache, unregisters itself and reloads each open tab,
// so the reload reaches the network and follows the URL map's 301 to
// www.jsolly.com. It has no fetch handler. Both copies are byte-identical.

async function retire() {
	await self.clients.claim();
	const keys = await caches.keys();
	await Promise.all(keys.map((key) => caches.delete(key)));
	await self.registration.unregister();
	const windows = await self.clients.matchAll({ type: "window" });
	await Promise.allSettled(
		windows.map((client) => client.navigate(client.url)),
	);
}

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(retire());
});
