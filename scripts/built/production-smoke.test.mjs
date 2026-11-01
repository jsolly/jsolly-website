import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import middleware from "../../middleware.js";
import { runSmoke } from "../../monitoring/production-smoke.mjs";
import {
	productionUrl,
	smoke,
	verifyRecipeWorker,
} from "../../monitoring/production-smoke-scenario.mjs";
import { rootVercelRoutes, routePath } from "../blogthedata-redirects.mjs";
import { serveStatic, stubOffOrigin } from "./pages.mjs";

// The production smoke scenario over the real built pages, run by the fleet
// runner itself (monitoring/production-smoke.mjs), so its failure rules apply:
// console and page errors, aborted or failing same-origin requests, non-2xx
// checks and its behaviour deadline, with service workers blocked. Nothing
// reaches the network: www.jsolly.com is answered by a local stand-in for
// Vercel, the real middleware (Markdown negotiation and Vary), then dist/,
// with vercel.json's headers (the feeds' XML types, the header CSP), and
// every other host by stubOffOrigin. The smoke suite's stub pages check the
// scenario's logic; this checks it against the markup the site ships.
const STATIC_RECIPE_SUMMARY =
	/^\/recipes\/data\/summaries\/library-[a-f0-9]{40}\.json$/u;
const JSON_TYPE = /^application\/json/u;
const POST_PATH = /^\/blog\/[^/]+\/$/u;
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const routes = rootVercelRoutes();

// Every method asked of the stand-in for Vercel: the browser's requests, the
// runner's checks and the scenario's context.request.
const methods = new Set();
let site;
let browser;

before(async () => {
	site = await serveStatic(DIST);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

const lowerCaseKeys = (headers) =>
	Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	);

// Answers `url` (on www.jsolly.com) as Vercel would: the middleware's own
// response when it negotiates one, otherwise the dist/ file with vercel.json's
// headers and the middleware's (its Vary). Resolves to a Response.
async function vercel(url, { method = "GET", accept = "*/*" } = {}) {
	methods.add(method);
	const { pathname } = new URL(url);
	const { redirect, headers: configured } = routePath(routes, pathname);
	if (redirect)
		throw new Error(`${pathname} redirects to ${redirect.location}`);
	const routed = middleware(new Request(url, { method, headers: { accept } }));
	const {
		"x-middleware-next": passThrough,
		"x-middleware-rewrite": rewrite,
		...fromMiddleware
	} = Object.fromEntries(routed.headers);
	if (!passThrough && !rewrite) {
		return new Response(await routed.arrayBuffer(), {
			status: routed.status,
			headers: { ...lowerCaseKeys(configured), ...fromMiddleware },
		});
	}
	const destination = rewrite ? new URL(rewrite) : new URL(url);
	if (destination.origin !== new URL(url).origin)
		throw new Error("middleware rewrites must stay same-origin");
	const file = await fetch(
		`${site.origin}${destination.pathname}${destination.search}`,
		{ method, headers: { accept } },
	);
	return new Response(await file.arrayBuffer(), {
		status: file.status,
		headers: {
			...Object.fromEntries(file.headers),
			...lowerCaseKeys(configured),
			...fromMiddleware,
		},
	});
}

// The runner's fetcher: Vercel's answer, at the URL asked for (nothing here
// redirects).
async function fetcher(url) {
	const response = await vercel(url);
	Object.defineProperty(response, "url", { value: url });
	return response;
}

// The scenario's context.request, for the Markdown negotiation checks.
const request = {
	async get(url, { headers }) {
		const response = await vercel(url, {
			method: "GET",
			accept: headers.accept,
		});
		const body = await response.text();
		return {
			status: () => response.status,
			headers: () => Object.fromEntries(response.headers),
			text: () => Promise.resolve(body),
		};
	},
};

// Hands the runner the real browser, but each context it opens answers
// www.jsolly.com from `vercel` and stubs every other host. The runner's own
// pass-through route (route.continue()) would reach production, so the
// context it gets ignores route(); tracing and pages are the real context's.
function launch() {
	const opened = [];
	return {
		opened,
		async newContext(options) {
			opened.push(options);
			const context = await browser.newContext(options);
			await stubOffOrigin(context, productionUrl);
			await context.route(
				(url) => url.origin === productionUrl,
				async (route) => {
					const browserRequest = route.request();
					const response = await vercel(browserRequest.url(), {
						method: browserRequest.method(),
						accept: browserRequest.headers().accept,
					});
					await route.fulfill({
						status: response.status,
						headers: Object.fromEntries(response.headers),
						body: Buffer.from(await response.arrayBuffer()),
					});
				},
			);
			return {
				route: () => Promise.resolve(),
				tracing: context.tracing,
				newPage: () => context.newPage(),
			};
		},
		close: () => Promise.resolve(),
	};
}

it("The production smoke passes on the built site under the runner's failure rules", {
	timeout: 120_000,
}, async () => {
	// The runner writes its artifacts under the working directory.
	const workDir = await mkdtemp(join(tmpdir(), "production-smoke-built-"));
	const cwd = process.cwd();
	const browserStub = launch();
	process.chdir(workDir);
	try {
		const releaseSha = JSON.parse(
			await readFile(
				new URL("../../dist/release.json", import.meta.url),
				"utf8",
			),
		).sha;
		const receipt = await runSmoke({
			scenario: {
				productionUrl,
				smoke: (args) => smoke({ ...args, releaseSha, context: { request } }),
			},
			env: {
				PRODUCTION_SMOKE_REQUEST_ID: "built-site",
				PRODUCTION_SMOKE_RELEASE_SHA: releaseSha,
			},
			fetcher,
			launch: () => Promise.resolve(browserStub),
			readinessMs: 0,
		});
		assert.deepEqual(receipt.errors, []);
		assert.equal(receipt.success, true);
		assert.deepEqual([...methods], ["GET"], "the smoke only reads");
		assert.deepEqual(browserStub.opened, [{ serviceWorkers: "block" }]);
		// The runner's own checks (readiness, then the scenario's verifyHttp).
		const checked = receipt.observations.filter(({ source }) => !source);
		const paths = checked.map(({ url }) => new URL(url).pathname);
		assert.match(paths[4], POST_PATH, "the fifth check is the post read");
		assert.deepEqual(paths.toSpliced(4, 1), [
			"/",
			"/release.json",
			"/about/",
			"/contact/",
			"/blog/search/",
			"/blog/rss.xml",
			"/blog/atom.xml",
			"/recipes/",
		]);
		assert.ok(
			checked.every(({ status }) => status === 200),
			"every check answers 200",
		);
	} finally {
		process.chdir(cwd);
		await rm(workDir, { recursive: true, force: true });
	}
});

it("The worker smoke proves summaries save nothing and an opened recipe reopens offline", {
	timeout: 90000,
}, async () => {
	const context = await browser.newContext({ serviceWorkers: "allow" });
	try {
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${site.origin}/recipes/`);
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
		await page.reload();
		await page.waitForFunction(() =>
			Boolean(navigator.serviceWorker.controller),
		);
		const evidence = await verifyRecipeWorker(page);
		assert.equal(evidence.savedCount, 1);
		assert.equal(evidence.reopenedOffline, true);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

for (const variant of [
	{
		title:
			"The runner waits for activation, reloads during a pending static summary download, and proves saved-only offline use",
		scope: "/recipes/",
		script: "/recipes/service-worker.js",
		valid: true,
	},
	{
		title:
			"The runner rejects a ready worker with the wrong scope before reload",
		scope: "/",
		script: "/recipes/service-worker.js",
		valid: false,
		failure: "registration",
	},
	{
		title:
			"The runner rejects a ready worker with the wrong script before reload",
		scope: "/recipes/",
		script: "/recipes/wrong-worker.js",
		valid: false,
		failure: "registration",
	},
	{
		title:
			"The runner still rejects summary cancellations before an explicit offline transition",
		scope: "/recipes/",
		script: "/recipes/service-worker.js",
		valid: false,
		failure: "online-summary",
	},
	{
		title:
			"The runner rejects unrelated JSON cancellation even during an explicit offline transition",
		scope: "/recipes/",
		script: "/recipes/service-worker.js",
		valid: false,
		failure: "offline-unrelated-json",
	},
	{
		title:
			"The runner still rejects missing cooking images during offline verification",
		scope: "/recipes/",
		script: "/recipes/service-worker.js",
		valid: false,
		failure: "offline-image",
	},
]) {
	it(variant.title, {
		timeout: 90000,
	}, async () => {
		const workDir = await mkdtemp(join(tmpdir(), "production-smoke-worker-"));
		const cwd = process.cwd();
		const summaryStarted = Promise.withResolvers();
		const releaseSummary = Promise.withResolvers();
		const cancellationHeld = Promise.withResolvers();
		// Preserve rejection for the worker handler while avoiding an unhandled
		// rejection if fixture setup fails before the worker asks for its script.
		void summaryStarted.promise.catch(() => {
			// The handler records and propagates the original error.
		});
		const pending = new Set();
		const fixtureErrors = [];
		const events = [];
		let cancellationPaths = [];
		let heldCancellations = 0;
		let summaryDelivered = false;
		let reloads = 0;
		let workerBrowseReady;
		let localBrowser;
		let server;
		try {
			await promisify(execFile)("openssl", [
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				join(workDir, "key.pem"),
				"-out",
				join(workDir, "cert.pem"),
				"-days",
				"1",
				"-subj",
				"/CN=localhost",
			]);
			server = createServer({
				key: await readFile(join(workDir, "key.pem")),
				cert: await readFile(join(workDir, "cert.pem")),
			});
			await new Promise((resolveListen, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", resolveListen);
			});
			const origin = `https://localhost:${server.address().port}`;
			server.on("request", (incoming, outgoing) => {
				const operation = (async () => {
					const url = new URL(incoming.url, origin);
					if (
						cancellationPaths.includes(url.pathname) &&
						url.searchParams.has("smoke-cancellation")
					) {
						heldCancellations++;
						if (heldCancellations === cancellationPaths.length)
							cancellationHeld.resolve();
						await releaseSummary.promise;
						outgoing.writeHead(200, { "Content-Type": "application/json" });
						outgoing.end("{}");
						return;
					}
					const response = await vercel(url.href, {
						method: incoming.method,
						accept: incoming.headers.accept,
					});
					assert.equal(response.status, 200, url.pathname);
					const body = Buffer.from(await response.arrayBuffer());
					if (STATIC_RECIPE_SUMMARY.test(url.pathname)) {
						events.push("summary-held");
						summaryStarted.resolve();
						await releaseSummary.promise;
						summaryDelivered = true;
					}
					if (url.pathname === "/recipes/service-worker.js") {
						// Installation cannot finish until the page's real background
						// request is held. This makes premature reload observable.
						await summaryStarted.promise;
						events.push("worker-sent");
					}
					outgoing.writeHead(
						response.status,
						Object.fromEntries(response.headers),
					);
					outgoing.end(body);
				})().catch((error) => {
					summaryStarted.reject(error);
					fixtureErrors.push(error);
					outgoing.destroy(error);
				});
				pending.add(operation);
				void operation.finally(() => pending.delete(operation));
			});
			localBrowser = await chromium.launch({
				args: ["--ignore-certificate-errors"],
			});
			process.chdir(workDir);
			const releaseSha = JSON.parse(
				await readFile(join(DIST, "release.json"), "utf8"),
			).sha;
			cancellationPaths =
				variant.failure === "offline-unrelated-json"
					? ["/recipes/data/summaries/unrelated.json"]
					: [
							`/recipes/data/summaries/library-${releaseSha}.json`,
							`/recipes/data/search/index-${releaseSha}.json`,
							"/api/recipe-browse/",
						];
			const receipt = await runSmoke({
				scenario: {
					productionUrl: `${origin}/`,
					// The ordinary scenario is covered above. Exercise the actual
					// runner's fresh worker context and saved-only proof here.
					smoke: async () => {
						// The ordinary scenario has its own actual-runner case above.
					},
					serviceWorker: {
						page: "/recipes/",
						scope: variant.scope,
						script: variant.script,
					},
					verifyRecipeWorker: async (page, transitions) => {
						await workerBrowseReady;
						const evidence = await verifyRecipeWorker(page, transitions);
						if (
							variant.valid ||
							["offline-image", "offline-unrelated-json"].includes(
								variant.failure,
							)
						) {
							// Exercise native browsing and both exact versioned artifacts.
							// The unrelated JSON variant proves the allowance stays narrow.
							const cancellationURLs = cancellationPaths.map(
								(path) => `${origin}${path}?smoke-cancellation=1`,
							);
							const requests = cancellationURLs.map((url) =>
								page.waitForRequest(
									(browserRequest) => browserRequest.url() === url,
								),
							);
							await page.evaluate((paths) => {
								globalThis.smokeSummaryAbort = new AbortController();
								for (const path of paths)
									void fetch(`${path}?smoke-cancellation=1`, {
										signal: globalThis.smokeSummaryAbort.signal,
									}).catch(() => {
										// The fixture deliberately aborts these held requests below.
									});
							}, cancellationPaths);
							const heldRequests = await Promise.all(requests);
							await cancellationHeld.promise;
							const cancelled = Promise.all(
								heldRequests.map((heldRequest) =>
									page.waitForEvent("requestfailed", {
										predicate: (browserRequest) =>
											browserRequest === heldRequest,
									}),
								),
							);
							transitions.beforeOffline();
							await page.context().setOffline(true);
							try {
								await page.evaluate(() => {
									globalThis.smokeSummaryAbort.abort();
									globalThis.smokeSummaryAbort = undefined;
								});
								await cancelled;
							} finally {
								await page.context().setOffline(false);
							}
						}
						if (variant.failure === "offline-image") {
							const image = await page
								.locator(".recipe-detail img")
								.first()
								.getAttribute("src");
							await page.evaluate(async () => {
								await Promise.all(
									(await caches.keys()).map(async (name) => {
										const cache = await caches.open(name);
										await Promise.all(
											(await cache.keys())
												.filter((cachedRequest) =>
													new URL(cachedRequest.url).pathname.startsWith(
														"/recipes/media/",
													),
												)
												.map((cachedRequest) => cache.delete(cachedRequest)),
										);
									}),
								);
							});
							transitions.beforeOffline();
							await page.context().setOffline(true);
							try {
								const imageFailed = page.waitForEvent("requestfailed", {
									predicate: (browserRequest) =>
										new URL(browserRequest.url()).pathname === image,
								});
								await page.evaluate(async (path) => {
									await fetch(path).catch(() => null);
								}, image);
								await imageFailed;
							} finally {
								await page.context().setOffline(false);
							}
						}
						return evidence;
					},
				},
				env: {
					PRODUCTION_SMOKE_REQUEST_ID: "built-worker-readiness",
					PRODUCTION_SMOKE_RELEASE_SHA: releaseSha,
				},
				fetcher,
				readinessMs: 0,
				launch: async () => ({
					close: () => localBrowser.close(),
					async newContext(options) {
						const context = await localBrowser.newContext({
							...options,
							ignoreHTTPSErrors: true,
						});
						await stubOffOrigin(context, origin);
						if (options.serviceWorkers === "allow") {
							if (variant.failure === "online-summary") {
								let requests = 0;
								await context.route(
									(url) => STATIC_RECIPE_SUMMARY.test(url.pathname),
									(route) => {
										requests++;
										return requests === 2
											? route.abort("aborted")
											: route.continue();
									},
								);
							}
							const newPage = context.newPage.bind(context);
							context.newPage = async () => {
								const page = await newPage();
								const reload = page.reload.bind(page);
								page.reload = async (settings) => {
									const state = await page.evaluate(async () => {
										const registration =
											await navigator.serviceWorker.getRegistration();
										return {
											state: registration?.active?.state,
											controlled: Boolean(navigator.serviceWorker.controller),
										};
									});
									assert.deepEqual(
										state,
										{ state: "activated", controlled: true },
										"reload must follow actual activation",
									);
									assert.deepEqual(events, ["summary-held", "worker-sent"]);
									assert.equal(
										summaryDelivered,
										false,
										"the static summary remains pending at reload",
									);
									reloads++;
									// Observe the next page before reload can start its summary.
									// The runner can otherwise reach verification after it failed.
									let summaryRequest;
									workerBrowseReady = Promise.all([
										page.waitForRequest((browserRequest) => {
											if (
												!STATIC_RECIPE_SUMMARY.test(
													new URL(browserRequest.url()).pathname,
												)
											)
												return false;
											summaryRequest = browserRequest;
											return true;
										}),
										variant.failure === "online-summary"
											? page.waitForEvent("requestfailed", {
													predicate: (browserRequest) =>
														browserRequest === summaryRequest,
												})
											: null,
									]);
									// Preserve rejection for verification without an unhandled
									// rejection if navigation itself fails first.
									void workerBrowseReady.catch(() => {
										// Verification still awaits the original rejected promise.
									});
									return reload(settings);
								};
								return page;
							};
						}
						return context;
					},
				}),
			});
			if (receipt.success !== variant.valid) {
				const failureDir = await mkdtemp(
					join(tmpdir(), "production-smoke-worker-failure-"),
				);
				await cp(join(workDir, "production-smoke-artifacts"), failureDir, {
					recursive: true,
				});
				process.stderr.write(`Worker smoke failure artifacts: ${failureDir}\n`);
			}
			assert.equal(
				receipt.success,
				variant.valid,
				JSON.stringify(receipt, null, 2),
			);
			const expectedError =
				variant.failure === "registration"
					? "Unexpected service worker registration"
					: variant.failure === "online-summary"
						? "/recipes/data/summaries/"
						: variant.failure === "offline-unrelated-json"
							? "/recipes/data/summaries/unrelated.json"
							: "/recipes/media/";
			assert.equal(
				receipt.errors.length === 0,
				variant.valid,
				JSON.stringify(receipt),
			);
			assert.equal(
				receipt.errors.some((error) => error.includes(expectedError)),
				!variant.valid,
				JSON.stringify(receipt),
			);
			assert.ok(
				receipt.errors.every(
					(error) =>
						error.includes(expectedError) ||
						error === "Error: Browser diagnostics failed" ||
						(variant.failure === "offline-image" &&
							error.startsWith("console: Failed to load resource")),
				),
				JSON.stringify(receipt),
			);
			assert.equal(reloads, variant.failure === "registration" ? 0 : 1);
			const cancellations = receipt.observations.filter(
				({ source, phase }) =>
					source === "verification-cancellation" && phase === "offline",
			);
			const expectedCancellations =
				variant.valid || variant.failure === "offline-image"
					? cancellationPaths
							.map((path) => `${origin}${path}?smoke-cancellation=1`)
							.sort((a, b) => a.localeCompare(b))
					: [];
			assert.deepEqual(
				cancellations.map(({ url }) => url).sort((a, b) => a.localeCompare(b)),
				expectedCancellations,
				JSON.stringify(receipt),
			);

			const evidence = receipt.observations.find(
				({ source }) => source === "service-worker",
			);
			assert.deepEqual(
				evidence && {
					state: evidence.state,
					controlled: evidence.controlled,
					savedCount: evidence.savedCount,
					reopenedOffline: evidence.reopenedOffline,
				},
				variant.failure !== "registration"
					? {
							state: "activated",
							controlled: true,
							savedCount: 1,
							reopenedOffline: true,
						}
					: undefined,
			);
		} finally {
			process.chdir(cwd);
			summaryStarted.resolve();
			releaseSummary.resolve();
			try {
				await localBrowser?.close();
			} finally {
				try {
					await Promise.all(pending);
					server?.closeAllConnections();
					if (server?.listening)
						await new Promise((resolveClose) => server.close(resolveClose));
				} finally {
					await rm(workDir, { recursive: true, force: true });
				}
			}
		}
		assert.deepEqual(fixtureErrors, []);
	});
}

it("JSON summary pagination passes the deployed middleware boundary", async () => {
	const release = JSON.parse(
		await readFile(join(DIST, "release.json"), "utf8"),
	).sha;
	const url = new URL("/api/recipe-browse/", productionUrl);
	url.search = new URLSearchParams({
		path: "/recipes/meals/",
		release,
	}).toString();
	const first = await vercel(url.href, { accept: "application/json" });
	assert.equal(first.status, 200);
	assert.match(first.headers.get("content-type"), JSON_TYPE);
	const result = await first.json();
	assert.equal(result.release, release);
	assert.equal(result.cards.length, 6);
	url.searchParams.set("page", String(result.nextPage));
	const next = await vercel(url.href, { accept: "application/json" });
	assert.equal(next.status, 200);
	const second = await next.json();
	assert.equal(second.cards.length, 6);
	assert.equal(
		new Set([...result.cards, ...second.cards].map((card) => card.id)).size,
		12,
	);
});
