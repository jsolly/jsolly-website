import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import {
	compileRoutes,
	JSOLLY_ORIGIN,
	LEGACY_DIR,
	readLegacyJson,
	routePath,
} from "../blogthedata-redirects.mjs";

// Two origins stand in for the cutover. Origin A first plays the old
// blogthedata.com: a cache-first recipe worker, like the retired ones (same
// script URLs, scopes and cache prefixes), precaches a page and controls it.
// Origin A then switches to the legacy redirect project: the files in
// legacy/blogthedata/public with the headers and 301s that vercel.json
// compiles to, pointed at origin B instead of www.jsolly.com. The browser's
// update check must install the kill-switch, which empties the caches,
// unregisters and reloads the tab onto origin B's mapped page.
const PUBLIC_DIR = join(LEGACY_DIR, "public");
const RECIPE_POST = "/post/15-minute-dump-and-go-instant-pot-recipes/";
const LANDING_TIMEOUT_MS = 15_000;
const POLL_MS = 100;
const CONTENT_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".txt": "text/plain; charset=utf-8",
};
const OLD_WORKERS = {
	"/recipe-service-worker.js": {
		cache: "recipe-pages-pwa-fixture",
		scope: "/",
		page: "/recipes/meals/",
	},
	[`${RECIPE_POST}service-worker.js`]: {
		cache: "recipe-pwa-fixture",
		scope: RECIPE_POST,
		page: RECIPE_POST,
	},
};

const routes = compileRoutes(readLegacyJson("vercel.json"));
const servers = [];
const origins = {};
let legacyMode = false;
let browser;

function oldWorker({ cache, page }) {
	return `const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify([page])};
self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE).then((store) => store.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
	const { pathname } = new URL(event.request.url);
	if (event.request.method !== "GET" || !ASSETS.includes(pathname)) return;
	event.respondWith(
		caches.match(pathname).then((hit) => hit ?? fetch(event.request)),
	);
});
`;
}

function oldPage(script, scope) {
	return `<!doctype html><html lang="en"><head><title>Recipes on blogthedata.com</title></head><body><p>Saved recipes</p><script>navigator.serviceWorker.register(${JSON.stringify(script)}, { scope: ${JSON.stringify(scope)}, updateViaCache: "none" });</script></body></html>`;
}

function serveOldSite(pathname, response) {
	for (const [script, worker] of Object.entries(OLD_WORKERS)) {
		if (pathname === script) {
			response.writeHead(200, { "Content-Type": "text/javascript" });
			response.end(oldWorker(worker));
			return;
		}
		if (pathname === worker.page) {
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			response.end(oldPage(script, worker.scope));
			return;
		}
	}
	response.writeHead(404, { "Content-Type": "text/plain" });
	response.end("not found");
}

async function readPublic(pathname) {
	// normalize() resolves "..", so the path never leaves PUBLIC_DIR.
	const file = join(PUBLIC_DIR, normalize(decodeURIComponent(pathname)));
	try {
		return { file, body: await fs.readFile(file) };
	} catch {
		return null;
	}
}

// The legacy project as Vercel serves it: compiled redirects first, then the
// output directory, then public/404.html, with the compiled headers.
async function serveLegacy(url, response) {
	const { redirect, headers } = routePath(routes, url.pathname);
	if (redirect) {
		response.writeHead(redirect.status, {
			Location: `${redirect.location.replace(JSOLLY_ORIGIN, origins.jsolly)}${url.search}`,
		});
		response.end();
		return;
	}
	const found = await readPublic(url.pathname);
	const served = found ?? (await readPublic("/404.html"));
	response.writeHead(found ? 200 : 404, {
		"Content-Type": CONTENT_TYPES[extname(served.file)],
		...headers,
	});
	response.end(served.body);
}

function listen(name, handler) {
	const server = createServer((request, response) => {
		handler(new URL(request.url, "http://127.0.0.1"), response).catch(
			(error) => {
				response.writeHead(500);
				response.end(String(error));
			},
		);
	});
	servers.push(server);
	return new Promise((resolveListen) => {
		server.listen(0, "127.0.0.1", () => {
			origins[name] = `http://127.0.0.1:${server.address().port}`;
			resolveListen();
		});
	});
}

// Opens a page under an old worker on origin A, waits until that worker
// controls the tab and returns the caches it filled.
async function openUnderOldWorker(context, path) {
	legacyMode = false;
	const page = await context.newPage();
	await page.goto(`${origins.blogthedata}${path}`);
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
	return { page, precached: await page.evaluate(() => caches.keys()) };
}

// Origin A's caches and registrations, polled until both are gone or the
// deadline passes (the registration is removed once its last tab has left).
async function originState(page, deadline) {
	const state = await page.evaluate(async () => ({
		caches: await caches.keys(),
		registrations: (await navigator.serviceWorker.getRegistrations()).length,
	}));
	const retired = state.caches.length === 0 && state.registrations === 0;
	if (retired || Date.now() > deadline) {
		return state;
	}
	await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS));
	return originState(page, deadline);
}

// After the kill-switch ran, origin A keeps no cache and no registration.
async function retiredOrigin(context) {
	const page = await context.newPage();
	await page.goto(`${origins.blogthedata}/404.html`);
	return originState(page, Date.now() + LANDING_TIMEOUT_MS);
}

before(async () => {
	await Promise.all([
		listen("blogthedata", (url, response) =>
			legacyMode
				? serveLegacy(url, response)
				: Promise.resolve(serveOldSite(url.pathname, response)),
		),
		listen("jsolly", (url, response) => {
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			response.end(
				`<!doctype html><html lang="en"><head><title>jsolly.com${url.pathname}</title></head><body></body></html>`,
			);
			return Promise.resolve();
		}),
	]);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await Promise.all(
		servers.map(
			(server) =>
				new Promise((resolveClose) => server.close(() => resolveClose())),
		),
	);
});

it("a recipe tab under the old root worker lands on jsolly.com after an update check", async () => {
	const context = await browser.newContext();
	try {
		const { page, precached } = await openUnderOldWorker(
			context,
			"/recipes/meals/",
		);
		assert.deepEqual(precached, ["recipe-pages-pwa-fixture"]);
		legacyMode = true;
		// Fire the update check without awaiting it: the kill-switch navigates
		// this tab away, which would destroy an awaited evaluation's context.
		await page.evaluate(() => {
			void navigator.serviceWorker
				.getRegistration()
				.then((registration) => registration.update());
		});
		await page.waitForURL(`${origins.jsolly}/recipes/meals/`, {
			timeout: LANDING_TIMEOUT_MS,
		});
		assert.deepEqual(await retiredOrigin(context), {
			caches: [],
			registrations: 0,
		});
	} finally {
		await context.close();
	}
});

it("the old recipe post under its own worker lands on jsolly.com /recipes/ after a reload", async () => {
	const context = await browser.newContext();
	try {
		const { page, precached } = await openUnderOldWorker(context, RECIPE_POST);
		assert.deepEqual(precached, ["recipe-pwa-fixture"]);
		legacyMode = true;
		// The cached page answers the reload; the navigation's update check
		// then installs the kill-switch.
		await page.reload({ waitUntil: "commit" });
		await page.waitForURL(`${origins.jsolly}/recipes/`, {
			timeout: LANDING_TIMEOUT_MS,
		});
		assert.deepEqual(await retiredOrigin(context), {
			caches: [],
			registrations: 0,
		});
	} finally {
		await context.close();
	}
});
