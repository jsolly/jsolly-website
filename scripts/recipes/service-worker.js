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
// Saved recipes have a separate lifetime from release shells. The registry write
// commits a fully verified, immutable bundle in one operation. Interrupted saves
// never become visible and never overwrite an existing saved recipe.
const SAVED_CACHE = "recipe-saved-registry-v1";
const SAVED_KEY = new URL("/recipes/__saved_recipes__", self.location.origin)
	.href;
const SAVED_LOCK = "recipe-saved-registry-v1";
const savedDocumentOwners = new Map();
async function savedRegistry() {
	if (!(await caches.has(SAVED_CACHE))) return { recipes: {}, clients: {} };
	const response = await (await caches.open(SAVED_CACHE)).match(SAVED_KEY);
	return response ? response.json() : { recipes: {}, clients: {} };
}
function updateSaved(change) {
	return navigator.locks.request(SAVED_LOCK, async () => {
		const value = await savedRegistry();
		await change(value);
		await (await caches.open(SAVED_CACHE)).put(SAVED_KEY, Response.json(value));
	});
}
async function completeSaved(entry) {
	if (!entry || !(await caches.has(entry.cache))) return false;
	const store = await caches.open(entry.cache);
	return (
		await Promise.all(
			entry.paths.map((path) => store.match(snapshotRequest(path))),
		)
	).every(Boolean);
}
function saveRecipe(id, release) {
	return navigator.locks.request(`${SAVED_LOCK}-${id}`, () =>
		saveRecipeLocked(id, release),
	);
}
async function saveRecipeLocked(id, release) {
	const existing = (await savedRegistry()).recipes[id];
	if (existing?.release === release && (await completeSaved(existing)))
		return existing;
	if (release !== RELEASE || !Object.hasOwn(RECIPE_MANIFESTS, id))
		throw new Error("Reload this recipe before saving its updated version.");
	const descriptor = RECIPE_MANIFESTS[id];
	const name = `recipe-saved-v1-${release}-${id}-${crypto.randomUUID()}`;
	try {
		const store = await caches.open(name);
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(new Error("Recipe manifest download timed out")),
			15_000,
		);
		let manifest;
		try {
			const response = await fetch(snapshotRequest(descriptor.path), {
				cache: "no-store",
				signal: controller.signal,
			});
			await verifyResponse(
				response,
				descriptor.path,
				descriptor,
				controller.signal,
			);
			manifest = await response.clone().json();
			if (
				manifest.schemaVersion !== 1 ||
				manifest.id !== id ||
				manifest.release !== RELEASE
			)
				throw new Error("Recipe manifest identity changed during saving.");
			await store.put(snapshotRequest(descriptor.path), response);
		} finally {
			clearTimeout(timer);
		}
		const digests = new Map(manifest.assets);
		await populateSnapshot(store, false, [...digests.keys()], digests);
		const pack = await (
			await store.match(snapshotRequest(`/recipes/data/packs/${id}.json`))
		).json();
		if (pack.releaseId !== RELEASE || pack.recipe?.id !== id)
			throw new Error(
				"Recipe data changed during saving. Reconnect and reopen it.",
			);
		const entry = {
			id,
			release,
			cache: name,
			savedAt: Date.now(),
			image: manifest.image,
			imagePaths: manifest.imagePaths,
			paths: [descriptor.path, ...digests.keys()],
		};
		await updateSaved((value) => {
			value.recipes[id] = entry;
		});
		return entry;
	} catch (error) {
		await caches.delete(name);
		throw error;
	}
}
async function listSaved() {
	const entries = Object.values((await savedRegistry()).recipes);
	const result = await Promise.all(
		entries.map(async (entry) => {
			if (!(await completeSaved(entry))) return null;
			const store = await caches.open(entry.cache);
			const [html, markdown, pack] = await Promise.all([
				store.match(snapshotRequest(`/recipes/${entry.id}/`)),
				store.match(snapshotRequest(`/recipes/${entry.id}.md`)),
				store.match(snapshotRequest(`/recipes/data/packs/${entry.id}.json`)),
			]);
			if (!html || !markdown || !pack) return null;
			const data = await pack.json();
			return {
				schemaVersion: data.schemaVersion,
				id: entry.id,
				release: entry.release,
				savedAt: entry.savedAt,
				recipe: data.recipe,
			};
		}),
	);
	return result.filter(Boolean);
}
const RECIPE_PAGE = /^\/recipes\/(?<id>[^/.]+)(?:\/|\.md)$/u;
const RECIPE_PACK = /^\/recipes\/data\/packs\/(?<id>[^/.]+)\.json$/u;
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
		// Prior complete snapshots remain read-only; only live client ownership expires.
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
async function populateSnapshot(
	store,
	reuse,
	paths = [...ASSETS],
	digests = ASSET_DIGESTS,
) {
	const batch = new AbortController();
	const entries = paths.map((path) => [path, digests.get(path)]);
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
// A fresh empty app needs no saved-library tools. Once recipes are saved, an
// update verifies its own deferred UI code without refreshing any recipe. The
// marker is written last, so an interrupted tools download is never readable.
const toolsCacheName = (shell) => `recipe-saved-tools-${shell}`;
async function prepareSavedView() {
	if (!(await listSaved()).length) return;
	const name = toolsCacheName(CACHE);
	await navigator.locks.request(name, async () => {
		const store = await caches.open(name);
		const key = snapshotRequest(SAVED_VIEW_MANIFEST.path);
		const previous = await store.match(key);
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(new Error("Saved view download timed out")),
			15_000,
		);
		try {
			const response =
				previous ??
				(await fetch(key, { cache: "no-store", signal: controller.signal }));
			await verifyResponse(
				response,
				SAVED_VIEW_MANIFEST.path,
				SAVED_VIEW_MANIFEST,
				controller.signal,
			);
			const manifest = await response.clone().json();
			if (manifest.schemaVersion !== 1 || manifest.release !== RELEASE)
				throw new Error("Saved view belongs to another release.");
			const digests = new Map(manifest.assets);
			await populateSnapshot(
				store,
				Boolean(previous),
				[...digests.keys()],
				digests,
			);
			if (!previous) await store.put(key, response);
		} catch (error) {
			if (!previous) await caches.delete(name);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	});
}
async function savedViewResponse(shell, key) {
	const name = toolsCacheName(shell);
	if (!(await caches.has(name))) return null;
	const store = await caches.open(name);
	if (!(await store.match(snapshotRequest(SAVED_VIEW_MANIFEST.path))))
		return null;
	return store.match(snapshotRequest(key));
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
				await prepareSavedView();
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
	if (event.data?.type === "SAVE_RECIPE") {
		event.waitUntil(
			saveRecipe(event.data.id, event.data.release).then(
				(entry) =>
					event.ports[0]?.postMessage({
						saved: true,
						id: entry.id,
						release: entry.release,
					}),
				() =>
					event.ports[0]?.postMessage({
						saved: false,
						error:
							"This recipe could not be saved offline. Reconnect and reopen it to retry.",
					}),
			),
		);
	} else if (event.data?.type === "LIST_SAVED_RECIPES") {
		event.waitUntil(
			listSaved().then(
				(recipes) => event.ports[0]?.postMessage({ recipes }),
				() =>
					event.ports[0]?.postMessage({
						error: "Saved recipes could not be read.",
					}),
			),
		);
	} else if (event.data?.type === "RECIPE_VERSION") {
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

			ownership.active = CACHE;
			if (ownership.pending?.token === current.token) ownership.pending = null;
			await saveOwners(ownership);
		}).then(() => self.clients.claim()),
	);
});

// Saved-document ownership is persisted, so restarting the worker cannot splice
// a newer pack or stylesheet into an older offline recipe.
async function savedResponse(event, key) {
	const value = await savedRegistry();
	const navigation = event.request.mode === "navigate";
	const id = key.match(RECIPE_PAGE)?.groups.id;
	const packId = key.match(RECIPE_PACK)?.groups.id;
	let record = navigation
		? value.recipes[id]
		: (savedDocumentOwners.get(event.clientId) ??
			value.clients[event.clientId] ??
			value.recipes[id ?? packId]);
	if (!record && !navigation && event.clientId) {
		// Storage can be full while a previously saved document is still readable.
		// Its canonical URL recovers ownership after a worker restart; hashed
		// runtime paths and the pack's release header prevent cross-release data.
		const client = await self.clients.get(event.clientId);
		const documentId =
			client && new URL(client.url).pathname.match(RECIPE_PAGE)?.groups.id;
		record = value.recipes[documentId];
	}
	if (!record) {
		// A current shell can load a saved recipe's deferred cooking tools.
		// Only use bundles from its release; older recipes open their own HTML.
		const shell = (await registry()).clients[event.clientId];
		const identity =
			shell && (await (await caches.open(shell)).match(META_KEY));
		const documentRelease = identity
			? (await identity.json()).release
			: RELEASE;
		const available = Object.values(value.recipes).filter(
			(entry) =>
				(entry.release === documentRelease && entry.paths.includes(key)) ||
				entry.imagePaths?.includes(key),
		);
		for (const entry of available) {
			// biome-ignore lint/performance/noAwaitInLoops: stop at the first complete matching release bundle.
			const response = await (await caches.open(entry.cache)).match(
				snapshotRequest(entry.imagePaths?.includes(key) ? entry.image : key),
			);
			if (response) return response;
		}
		return null;
	}
	if (navigation && !(await completeSaved(record))) return null;
	const expectedRelease = event.request.headers.get("X-Recipe-Release");
	if (expectedRelease && expectedRelease !== record.release) return null;
	const store = await caches.open(record.cache);
	let response = await store.match(snapshotRequest(key));
	if (!response && key.startsWith("/recipes/media/") && record.image)
		response = await store.match(snapshotRequest(record.image));
	if (response && navigation && event.resultingClientId) {
		savedDocumentOwners.set(event.resultingClientId, record);
		try {
			await updateSaved((saved) => {
				saved.clients[event.resultingClientId] = record;
			});
		} catch {
			// A full disk must not make a complete saved recipe unreadable.
			// Canonical-URL recovery above does not require a storage write.
		}
	}
	return response;
}
self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (
		!["GET", "HEAD"].includes(request.method) ||
		url.origin !== self.location.origin ||
		url.pathname === "/release.json" ||
		// Dynamic browse responses are never offline assets. Owning their fetch
		// events would let a slow backend keep this worker alive during an update.
		url.pathname === "/api/recipe-browse/" ||
		(recipeBrowseDestination(request) &&
			preferredType(request.headers.get("accept")) === "text/html")
	)
		return;
	let key = url.pathname;
	const recipeId = key.match(RECIPE_PAGE)?.groups.id;
	if (
		key.endsWith("/") &&
		(ASSETS.has(key) || Object.hasOwn(RECIPE_MANIFESTS, recipeId ?? ""))
	) {
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
	event.respondWith(
		(async () => {
			let response;
			if (request.mode !== "navigate")
				response = await savedResponse(event, key);
			if (!response) {
				const retained = await registry();
				const oldCache =
					request.mode === "navigate" ? null : retained.clients[event.clientId];
				const store = await caches.open(oldCache ?? CACHE);
				response = await store.match(snapshotRequest(key));
				if (!oldCache && !ASSETS.has(key)) response = null;
				if (!response && request.mode !== "navigate")
					response = await savedViewResponse(oldCache ?? CACHE, key);
			}
			if (!response) {
				try {
					response = await fetch(request);
				} catch (error) {
					response = await savedResponse(event, key);
					if (
						!response &&
						request.mode === "navigate" &&
						key.endsWith("/") &&
						key.startsWith("/recipes/")
					)
						return Response.redirect(
							new URL("/recipes/saved/", self.location.origin),
							302,
						);
					if (!response && key === "/blog/media/default.webp")
						return new Response(
							request.method === "HEAD"
								? null
								: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
							{ headers: { "content-type": "image/svg+xml" } },
						);
					if (!response) throw error;
				}
			}
			return request.method === "HEAD"
				? new Response(null, {
						status: response.status,
						statusText: response.statusText,
						headers: response.headers,
					})
				: response;
		})(),
	);
});
