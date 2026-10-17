import {
	markdownSiblingPath,
	preferredType,
} from "../../src/lib/accept-negotiate.js";
import { recipeBrowseDestination } from "../../src/lib/recipe-browse-route.mjs";

// The build prepends CACHE, PREFIX, RELEASE and ASSET_DIGESTS for one snapshot.
const CLIENTS_KEY = new URL(
	"/recipes/__previous_snapshot_clients__",
	self.location.origin,
).href;
const META_KEY = new URL("/recipes/__snapshot_identity__", self.location.origin)
	.href;
const OWNERS_CACHE = `${PREFIX}ownership`;
const OWNERS_KEY = new URL("/recipes/__snapshot_owners__", self.location.origin)
	.href;
const LOCK = `${PREFIX}snapshot-ownership`;
const ownershipLock = (operation) => navigator.locks.request(LOCK, operation);
async function owners() {
	const response = await (await caches.open(OWNERS_CACHE)).match(OWNERS_KEY);
	return response ? response.json() : { active: null, pending: null };
}
async function saveOwners(value) {
	await (await caches.open(OWNERS_CACHE)).put(OWNERS_KEY, Response.json(value));
}
const FULL_SHA = /^[a-f0-9]{40}$/u;
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
const inScope = (client) =>
	client?.type === "window" &&
	new URL(client.url).origin === self.location.origin &&
	new URL(client.url).pathname.startsWith("/recipes/");
async function snapshots() {
	const names = (await caches.keys()).filter(
		(name) =>
			name.startsWith(PREFIX) && name !== CACHE && name !== OWNERS_CACHE,
	);
	const records = await Promise.all(
		names.map(async (name) => {
			const store = await caches.open(name);
			const meta = await store.match(META_KEY);
			if (meta) {
				const identity = await meta.json();
				return identity.active === true
					? {
							name,
							release: identity.release,
							generation: identity.generation ?? 0,
						}
					: null;
			}
			// The last deployed worker had no identity marker. A complete cached
			// landing page identifies that legacy snapshot, not an empty failed install.
			return (await store.match(snapshotRequest("/recipes/")))
				? { name, release: null, generation: 0 }
				: null;
		}),
	);
	return records.filter(Boolean).sort((a, b) => a.generation - b.generation);
}
async function registry() {
	const response = await (await caches.open(CACHE)).match(CLIENTS_KEY);
	return response ? response.json() : { clients: {}, caches: [] };
}
function clientReady(client, release) {
	return ownershipLock(async () => {
		const ownership = await owners();
		// A queued message in the previous worker cannot retire the new worker.
		if (ownership.active !== CACHE) return;
		const retained = await registry();
		if (release === RELEASE) delete retained.clients[client.id];
		else {
			const matching = (await snapshots()).find(
				(snapshot) => snapshot.release === release,
			);
			if (matching) retained.clients[client.id] = matching.name;
		}
		const live = new Set(
			(
				await self.clients.matchAll({
					type: "window",
					includeUncontrolled: true,
				})
			).map((entry) => entry.id),
		);
		retained.clients = Object.fromEntries(
			Object.entries(retained.clients).filter(([id]) => live.has(id)),
		);
		const needed = new Set(Object.values(retained.clients));
		if (ownership.pending) needed.add(ownership.pending.cache);
		const retired = retained.caches.filter((name) => !needed.has(name));
		await Promise.all(retired.map((name) => caches.delete(name)));
		retained.caches = retained.caches.filter((name) => needed.has(name));
		const store = await caches.open(CACHE);
		if (retained.caches.length)
			await store.put(CLIENTS_KEY, Response.json(retained));
		else await store.delete(CLIENTS_KEY);
	});
}
// Verify a clone so the exact original response, including its headers, is cached.
// The build binds both digest and decoded byte count; never buffer an unbounded body.
async function verifyResponse(response, path, expected, signal) {
	if (!response?.ok || response.redirected || !response.body)
		throw new Error(`Recipe snapshot response unavailable: ${path}`);
	const reader = response.clone().body.getReader();
	const cancel = () => {
		void reader.cancel(signal.reason).catch(() => {
			/* Cancellation can race an already closed stream. */
		});
	};
	signal.addEventListener("abort", cancel, { once: true });
	const chunks = [];
	let size = 0;
	try {
		if (signal.aborted) throw signal.reason;
		// biome-ignore lint/suspicious/noUnnecessaryConditions: read until the stream explicitly ends.
		while (true) {
			// biome-ignore lint/performance/noAwaitInLoops: stream reads must be sequential to bound buffered bytes.
			const { value, done } = await reader.read();
			if (signal.aborted) throw signal.reason;
			if (done) break;
			size += value.byteLength;
			if (size > expected.size)
				throw new Error(`Recipe snapshot exceeds expected size: ${path}`);
			chunks.push(value);
		}
		if (size !== expected.size)
			throw new Error(`Recipe snapshot size mismatch: ${path}`);
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
		const actual = [...digest]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		if (actual !== expected.sha256)
			throw new Error(`Recipe snapshot integrity check failed: ${path}`);
	} finally {
		signal.removeEventListener("abort", cancel);
		void reader.cancel().catch(() => {
			/* Cancellation can race an already closed stream. */
		});
	}
}
async function populateSnapshot(store, reuse) {
	const batch = new AbortController();
	const entries = [...ASSET_DIGESTS];
	let cursor = 0;
	async function consume() {
		if (!batch.signal.aborted && cursor < entries.length) {
			const [path, expected] = entries[cursor++];
			const controller = new AbortController();
			const abort = () => controller.abort(batch.signal.reason);
			batch.signal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(
				() => controller.abort(new Error(`Recipe snapshot timed out: ${path}`)),
				15_000,
			);
			let response;
			try {
				const request = snapshotRequest(path);
				response = reuse
					? await store.match(request)
					: await fetch(request, {
							signal: controller.signal,
							cache: "no-store",
						});
				await verifyResponse(response, path, expected, controller.signal);
				if (controller.signal.aborted) throw controller.signal.reason;
				if (!reuse) await store.put(request, response);
			} catch (error) {
				batch.abort(error);
				controller.abort(error);
				if (response?.body)
					void response.body.cancel().catch(() => {
						/* Cancellation can race an already closed stream. */
					});
				throw error;
			} finally {
				clearTimeout(timer);
				batch.signal.removeEventListener("abort", abort);
			}
			return consume();
		}
	}
	// Settle every task before a failed candidate can be deleted or retried.
	await Promise.allSettled(
		Array.from({ length: Math.min(8, entries.length) }, consume),
	);
	if (batch.signal.aborted) throw batch.signal.reason;
}
self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const token = crypto.randomUUID();
			let reuse = false;
			await ownershipLock(async () => {
				const ownership = await owners();
				if (!ownership.active)
					ownership.active = (await snapshots()).at(-1)?.name ?? null;
				const store = await caches.open(CACHE);
				const response = await store.match(META_KEY);
				const identity = response && (await response.json());
				reuse = identity?.active === true;
				if (reuse && identity.release !== RELEASE)
					throw new Error("Recipe cache identity mismatch");
				ownership.pending = { cache: CACHE, token };
				await saveOwners(ownership);
				await store.put(
					META_KEY,
					Response.json({
						...identity,
						release: RELEASE,
						active: reuse,
						token,
					}),
				);
			});
			try {
				await populateSnapshot(await caches.open(CACHE), reuse);
				await ownershipLock(async () => {
					if ((await owners()).pending?.token !== token)
						throw new Error("Recipe installation was superseded");
				});
			} catch (error) {
				await ownershipLock(async () => {
					const ownership = await owners();
					if (ownership.pending?.token !== token) return;
					ownership.pending = null;
					await saveOwners(ownership);
					if (!reuse && ownership.active !== CACHE) await caches.delete(CACHE);
				});
				throw error;
			}
		})(),
	);
});
self.addEventListener("message", (event) => {
	if (!inScope(event.source)) return;
	if (event.data?.type === "RECIPE_VERSION") {
		event.ports[0]?.postMessage({ release: RELEASE });
	} else if (
		event.data?.type === "ACTIVATE_RECIPE_UPDATE" &&
		event.data.release === RELEASE
	) {
		event.waitUntil(self.skipWaiting());
	} else if (
		event.data?.type === "RECIPE_CLIENT_READY" &&
		FULL_SHA.test(event.data.release ?? "")
	) {
		event.waitUntil(clientReady(event.source, event.data.release));
	}
});
self.addEventListener("activate", (event) => {
	event.waitUntil(
		ownershipLock(async () => {
			const ownership = await owners();
			const store = await caches.open(CACHE);
			const current = await (await store.match(META_KEY)).json();
			// Candidates own their cache until activation, independent of live documents.
			await Promise.all(
				(await caches.keys())
					.filter(
						(name) =>
							name.startsWith(PREFIX) &&
							name !== CACHE &&
							name !== OWNERS_CACHE &&
							name !== ownership.pending?.cache,
					)
					.map(async (name) => {
						const candidate = await caches.open(name);
						const response = await candidate.match(META_KEY);
						const identity = response && (await response.json());
						if (
							identity
								? identity.active !== true
								: !(await candidate.match(snapshotRequest("/recipes/")))
						)
							await caches.delete(name);
					}),
			);
			const previous = await snapshots();
			const clients = (
				await self.clients.matchAll({
					type: "window",
					includeUncontrolled: true,
				})
			).filter(inScope);
			const mappings = {};
			// Activation generations carry ownership forward even through rollbacks.
			for (const snapshot of previous) {
				// biome-ignore lint/performance/noAwaitInLoops: apply registries in activation order.
				const response = await (await caches.open(snapshot.name)).match(
					CLIENTS_KEY,
				);
				if (response) Object.assign(mappings, (await response.json()).clients);
			}
			const defaultCache =
				previous.findLast((snapshot) => snapshot.release !== null)?.name ??
				previous[0]?.name;
			const retained = {
				clients: {},
				caches: previous.map((snapshot) => snapshot.name),
			};
			if (defaultCache)
				for (const client of clients)
					retained.clients[client.id] = mappings[client.id] ?? defaultCache;
			const generation =
				Math.max(
					current.generation ?? 0,
					...previous.map((snapshot) => snapshot.generation),
					0,
				) + 1;
			await store.put(
				META_KEY,
				Response.json({
					release: RELEASE,
					active: true,
					generation,
					token: current.token,
				}),
			);
			if (clients.length && retained.caches.length)
				await store.put(CLIENTS_KEY, Response.json(retained));
			else
				await Promise.all(
					retained.caches
						.filter((name) => name !== ownership.pending?.cache)
						.map((name) => caches.delete(name)),
				);
			ownership.active = CACHE;
			if (ownership.pending?.token === current.token) ownership.pending = null;
			await saveOwners(ownership);
		}).then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (
		!["GET", "HEAD"].includes(request.method) ||
		url.origin !== self.location.origin ||
		url.pathname === "/release.json" ||
		(recipeBrowseDestination(request) &&
			preferredType(request.headers.get("accept")) === "text/html")
	)
		return;
	let key = url.pathname;
	if (key.endsWith("/") && ASSETS.has(key)) {
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
	if (request.mode === "navigate" && !key.endsWith("/") && !key.endsWith(".md"))
		return;
	// A navigation obtains a complete current document. Subresources/data from
	// an old document retain its snapshot, so B never splices mutable B data into A.
	event.respondWith(
		(async () => {
			const retained = await registry();
			const oldCache =
				request.mode === "navigate" ? null : retained.clients[event.clientId];
			const store = await caches.open(oldCache ?? CACHE);
			const cached = await store.match(snapshotRequest(key));
			if (!cached || (!oldCache && !ASSETS.has(key))) return fetch(request);
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
