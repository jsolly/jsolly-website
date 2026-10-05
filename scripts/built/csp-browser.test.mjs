import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { readHeaderPolicy } from "../csp.mjs";
import { serveStatic } from "./pages.mjs";

// Plan §4.4(c): the built pages under both policies a browser enforces in
// production, the vercel.json response header (served on every response, as
// Vercel does) and each page's Astro meta policy. Any securitypolicyviolation
// fails. Off-origin requests are answered locally with stand-ins and recorded:
// a blocked request never leaves the page (the violation fires instead), so
// each page must also have requested the hosts its content uses, which proves
// the lazy embeds and images (switched to eager) were loaded, not skipped. Every
// island must hydrate, so the page's own scripts ran under both policies.
const DIST = "dist";
const CLOUDFRONT = "d1d7p8ufhgz4ld.cloudfront.net";
const PAGES = [
	{ path: "/blog/", hosts: [CLOUDFRONT] },
	{
		path: "/blog/how-to-debug-an-astro-app/",
		hosts: ["www.youtube.com", CLOUDFRONT],
	},
	{
		path: "/blog/Planetary-Computer-STAC-Landsat-data/",
		hosts: ["nbviewer.org", CLOUDFRONT],
	},
	{
		path: "/blog/productivity-flow-chart/",
		hosts: ["viewer.diagrams.net", CLOUDFRONT],
	},
	{ path: "/about/", hosts: [] },
];
// How long one page may take to hydrate, settle its images or request a host.
const WAIT_MS = 15_000;
const STAND_INS = {
	document: {
		contentType: "text/html",
		body: "<!doctype html><title>stand-in</title>",
	},
	image: {
		contentType: "image/svg+xml",
		body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />',
	},
};

let site;
let browser;

before(async () => {
	site = await serveStatic(DIST, {
		"Content-Security-Policy": await readHeaderPolicy(),
	});
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

// Opens `path` and switches every lazy image and iframe to eager so each
// loads, then waits until every island has hydrated, every image has settled
// and each of `expected` hosts has been requested (or WAIT_MS passes). Returns
// the violations, the off-origin hosts it requested and the page errors.
async function visit(path, expected) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const hosts = new Set();
	const { promise: allRequested, resolve } = Promise.withResolvers();
	const check = () => {
		if (expected.every((host) => hosts.has(host))) resolve();
	};
	check();
	await context.route(
		(url) => url.origin !== site.origin,
		(route) => {
			const request = route.request();
			hosts.add(new URL(request.url()).host);
			check();
			const kind = request.resourceType() === "image" ? "image" : "document";
			return route.fulfill(STAND_INS[kind]);
		},
	);
	await context.addInitScript(() => {
		window.__violations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			window.__violations.push(
				`${event.effectiveDirective} blocked ${event.blockedURI || "inline"} (${event.sourceFile}:${event.lineNumber})`,
			);
		});
	});
	const page = await context.newPage();
	page.setDefaultTimeout(WAIT_MS);
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	let timer;
	try {
		await page.goto(`${site.origin}${path}`, { waitUntil: "load" });
		await page.evaluate(() => {
			for (const element of document.querySelectorAll("img, iframe")) {
				element.loading = "eager";
			}
		});
		await page.waitForFunction(
			() =>
				!document.querySelector("astro-island[ssr]") &&
				Array.from(document.images).every((image) => image.complete),
		);
		await Promise.race([
			allRequested,
			new Promise((resolveTimer) => {
				timer = setTimeout(resolveTimer, WAIT_MS);
			}),
		]);
		return {
			violations: await page.evaluate(() => window.__violations),
			requested: [...hosts].sort((a, b) => a.localeCompare(b, "en")),
			errors,
		};
	} finally {
		clearTimeout(timer);
		await context.close();
	}
}

it("blog posts with embeds, the blog home and /about/ load under the vercel.json header and their meta policy without a violation", {
	timeout: 120_000,
}, async () => {
	// One page at a time keeps each page's requests its own.
	const results = await PAGES.reduce(
		async (previous, page) => [
			...(await previous),
			{ ...page, ...(await visit(page.path, page.hosts)) },
		],
		Promise.resolve([]),
	);
	for (const { path, hosts, ...result } of results) {
		assert.deepEqual(result.violations, [], `${path}: CSP violations`);
		assert.deepEqual(result.errors, [], `${path}: page errors`);
		for (const host of hosts) {
			assert.ok(
				result.requested.includes(host),
				`${path} requested ${host} (requested: ${result.requested.join(", ") || "none"})`,
			);
		}
	}
});
