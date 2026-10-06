import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { readHeaderPolicy } from "../csp.mjs";
import { serveStatic, stubOffOrigin } from "./pages.mjs";

// Plan §4.4(c): the built pages under both policies a browser enforces in
// production, the vercel.json response header (served on every response, as
// Vercel does) and each page's Astro meta policy. Any securitypolicyviolation
// fails. Off-origin requests are answered locally with stand-ins and recorded:
// a blocked request never leaves the page (the violation fires instead), so
// each page must also have requested the hosts its content uses, which proves
// the lazy embeds and images (switched to eager) were loaded, not skipped. Every
// island must hydrate, so the page's own scripts ran under both policies.
// Positive control: each response carries the header policy and each page a
// meta policy, and an image from an unlisted host injected on /about/ must
// raise exactly one img-src violation under each of the two policies.
const DIST = "dist";
const CLOUDFRONT = "d1d7p8ufhgz4ld.cloudfront.net";
const UNLISTED_IMAGE = "https://example.invalid/x.png";
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
	// The search island fetches its index and parses it with zod (jitless, so
	// no eval) before any result card renders.
	{
		path: "/blog/search/?searched=django",
		hosts: [CLOUDFRONT],
		prepare: loadSearchResults,
	},
	{ path: "/about/", hosts: [] },
	// A recipe page for its island scripts and same-origin recipe images, with
	// the notation dialog opened so its bits-ui code runs too (the inline
	// styles it sets fall under style-src 'unsafe-inline').
	{
		path: "/recipes/greek-turkey-patties/",
		hosts: [],
		prepare: openMethodDialog,
	},
];
// How long one page may take to hydrate, settle its images or request a host.
const WAIT_MS = 15_000;
const POLL_MS = 50;

let site;
let browser;
let headerPolicy;

before(async () => {
	headerPolicy = await readHeaderPolicy();
	site = await serveStatic(DIST, { "Content-Security-Policy": headerPolicy });
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

// Waits for the search results, which render after the page has loaded, and
// switches their lazy card images to eager too.
async function loadSearchResults(page) {
	await page.locator(".post-card").first().waitFor();
	await page.evaluate(() => {
		for (const image of document.querySelectorAll(".post-card img")) {
			image.loading = "eager";
		}
	});
}

async function openMethodDialog(page) {
	await page
		.getByRole("button", { name: "Learn more about Tabular Recipe Notation" })
		.click();
	await page.getByRole("dialog").waitFor();
}

// Resolves once `hosts` (a growing Set) holds every `expected` host, or after
// WAIT_MS; the caller's assertions then name whatever is missing.
function hostsRequested(hosts, expected) {
	return new Promise((resolve) => {
		const started = Date.now();
		const timer = setInterval(() => {
			if (
				expected.every((host) => hosts.has(host)) ||
				Date.now() - started > WAIT_MS
			) {
				clearInterval(timer);
				resolve();
			}
		}, POLL_MS);
	});
}

// Opens `path` and switches every lazy image and iframe to eager so each
// loads, then waits until every island has hydrated, every image has settled
// and each `expected` host has been requested; `prepare(page)`, when given,
// runs after the switch and before those waits. Returns the
// response's CSP header, the page's meta policies, the violations, the
// off-origin hosts it requested and the page errors.
async function visit(path, expected, prepare) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const hosts = await stubOffOrigin(context, site.origin);
	await context.addInitScript(() => {
		window.__violations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			window.__violations.push({
				directive: event.effectiveDirective,
				blocked: event.blockedURI,
				policy: event.originalPolicy,
			});
		});
	});
	const page = await context.newPage();
	page.setDefaultTimeout(WAIT_MS);
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	try {
		const response = await page.goto(`${site.origin}${path}`, {
			waitUntil: "load",
		});
		await page.evaluate(() => {
			for (const element of document.querySelectorAll("img, iframe")) {
				element.loading = "eager";
			}
		});
		await prepare?.(page);
		await page.waitForFunction(
			() =>
				!document.querySelector("astro-island[ssr]") &&
				Array.from(document.images).every((image) => image.complete),
		);
		await hostsRequested(hosts, expected);
		return {
			header: response?.headers()["content-security-policy"],
			metaPolicies: await page
				.locator('meta[http-equiv="content-security-policy"]')
				.evaluateAll((metas) => metas.map((meta) => meta.content)),
			violations: await page.evaluate(() => window.__violations),
			requested: [...hosts].sort((a, b) => a.localeCompare(b, "en")),
			errors,
		};
	} finally {
		await context.close();
	}
}

it("blog posts with embeds, the blog home, a blog search, /about/ and a recipe page with its dialog open load under the vercel.json header and their meta policy without a violation", {
	timeout: 120_000,
}, async () => {
	// One page at a time keeps each page's requests its own.
	const results = await PAGES.reduce(
		async (previous, { path, hosts, prepare }) => [
			...(await previous),
			{ path, hosts, ...(await visit(path, hosts, prepare)) },
		],
		Promise.resolve([]),
	);
	for (const { path, hosts, ...result } of results) {
		assert.equal(result.header, headerPolicy, `${path}: header policy sent`);
		assert.equal(result.metaPolicies.length, 1, `${path}: one meta policy`);
		assert.deepEqual(result.violations, [], `${path}: CSP violations`);
		assert.deepEqual(result.errors, [], `${path}: page errors`);
		for (const host of hosts) {
			assert.ok(
				result.requested.includes(host),
				`${path} requested ${host} (requested: ${result.requested.join(", ") || "none"})`,
			);
		}
	}
	// Each enforced policy that blocks a request reports it once, so the
	// unlisted image raises one img-src violation from the header and one
	// from the meta policy.
	const control = await visit("/about/", [], async (page) => {
		await page.evaluate((src) => {
			const image = document.createElement("img");
			image.src = src;
			image.alt = "";
			document.body.append(image);
		}, UNLISTED_IMAGE);
		await page.waitForFunction(() => window.__violations.length >= 2);
	});
	const policyName = (policy) =>
		({ [headerPolicy]: "header", [control.metaPolicies[0]]: "meta" })[policy] ??
		policy;
	assert.deepEqual(
		control.violations
			.map(({ policy, ...violation }) => ({
				...violation,
				policy: policyName(policy),
			}))
			.sort((a, b) => a.policy.localeCompare(b.policy, "en")),
		["header", "meta"].map((policy) => ({
			directive: "img-src",
			blocked: UNLISTED_IMAGE,
			policy,
		})),
		"an image from an unlisted host raises exactly one img-src violation per policy",
	);
	assert.ok(
		!control.requested.includes(new URL(UNLISTED_IMAGE).host),
		"the blocked image never left the page",
	);
});
