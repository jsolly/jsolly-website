declare const CONTROL_VERSION: number;
declare const self: ServiceWorkerGlobalScope;
const worker = self;
const url = new URL(worker.location.href);
const mode = url.searchParams.get("mode");
const target = url.searchParams.get("target");
if (!target) throw new Error("Missing loopback sentinel URL");
// Both revisions are compiled from this physical typed source.
if (mode === "import") worker.importScripts(target);
worker.addEventListener("install", (event) => {
	if (mode === "install" || (mode === "update" && CONTROL_VERSION === 2))
		event.waitUntil(
			fetch(target).then((response) => {
				if (!response.ok) throw new Error("sentinel status");
			}),
		);
	worker.skipWaiting();
});
worker.addEventListener("activate", (event) =>
	event.waitUntil(worker.clients.claim()),
);
worker.addEventListener("fetch", (event) => {
	if (new URL(event.request.url).pathname === "/through-service-worker")
		event.respondWith(fetch(target));
});

export {};
