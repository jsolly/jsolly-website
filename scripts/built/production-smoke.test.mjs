import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import middleware from "../../middleware.js";
import { rootVercelRoutes, routePath } from "../blogthedata-redirects.mjs";
import { runSmoke } from "../production-smoke.mjs";
import { productionUrl, smoke } from "../production-smoke-scenario.mjs";
import { serveStatic, stubOffOrigin } from "./pages.mjs";

// The production smoke scenario over the real built pages, run by the fleet
// runner itself (scripts/production-smoke.mjs), so its failure rules apply:
// console and page errors, aborted or failing same-origin requests, non-2xx
// checks and its behaviour deadline, with service workers blocked. Nothing
// reaches the network: www.jsolly.com is answered by a local stand-in for
// Vercel, the real middleware (Markdown negotiation and Vary), then dist/,
// with vercel.json's headers (the feeds' XML types, the header CSP), and
// every other host by stubOffOrigin. The smoke suite's stub pages check the
// scenario's logic; this checks it against the markup the site ships.
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
	const { pathname, search } = new URL(url);
	const { redirect, headers: configured } = routePath(routes, pathname);
	if (redirect)
		throw new Error(`${pathname} redirects to ${redirect.location}`);
	const routed = middleware(new Request(url, { method, headers: { accept } }));
	const { "x-middleware-next": passThrough, ...fromMiddleware } =
		Object.fromEntries(routed.headers);
	if (!passThrough) {
		return new Response(await routed.arrayBuffer(), {
			status: routed.status,
			headers: { ...lowerCaseKeys(configured), ...fromMiddleware },
		});
	}
	const file = await fetch(`${site.origin}${pathname}${search}`, { method });
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
		const receipt = await runSmoke({
			scenario: {
				productionUrl,
				smoke: (args) => smoke({ ...args, context: { request } }),
			},
			env: {
				PRODUCTION_SMOKE_REQUEST_ID: "built-site",
				PRODUCTION_SMOKE_RELEASE_SHA: "0".repeat(40),
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
		assert.match(paths[3], POST_PATH, "the fourth check is the post read");
		assert.deepEqual(paths.toSpliced(3, 1), [
			"/",
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
