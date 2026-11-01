import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
import { collectErrors, stubOffOrigin } from "./pages.mjs";
import { createTempCopy, requireSuccess } from "./temp-copy.mjs";

const SERVINGS = /^Servings/u;
const RECIPE_TITLE = /Greek.*Turkey/iu;
const CSS_ASSET_URL = /url\(["']?(?<url>\/_astro\/[^)"']+)["']?\)/gu;
const IDS = { A: "dpl_retention_fixture_A", B: "dpl_retention_fixture_B" };
const MIME = {
	".js": "text/javascript",
	".css": "text/css",
	".html": "text/html",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".md": "text/markdown",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".woff": "font/woff",
};
const hash = (body) => createHash("sha256").update(body).digest("hex");
let copy;
let server;
let browser;
let origin;
let current = "A";
const snapshots = {};

beforeAll(async () => {
	copy = await createTempCopy("asset-retention");
	await writeFile(
		join(copy.dir, "src/pages/retention-probe.astro"),
		`---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout title="Retention fixture" description="Isolated browser fixture" noindex><h1>Retention fixture</h1><div class="retention-probe">Deferred style</div><script>window.loadRetentionProbe = () => import('../lib/retention-lazy.js').then(module => module.value);</script></Layout>`,
	);
	for (const label of ["A", "B"]) {
		// biome-ignore lint/performance/noAwaitInLoops: each build owns the same fixture sequentially.
		await writeFile(
			join(copy.dir, "src/lib/retention-lazy.js"),
			`import './retention-lazy.css'; export const value = '${label}';`,
		);
		await writeFile(
			join(copy.dir, "src/lib/retention-lazy.css"),
			`.retention-probe { color: ${label === "A" ? "rgb(10, 20, 30)" : "rgb(40, 50, 60)"}; }`,
		);
		requireSuccess(
			copy.npmRun("build", {
				VERCEL: "1",
				VERCEL_ENV: "production",
				VERCEL_SKEW_PROTECTION_ENABLED: "1",
				VERCEL_DEPLOYMENT_ID: IDS[label],
				VERCEL_GIT_COMMIT_SHA: label.toLowerCase().repeat(40),
				GITHUB_SHA: label.toLowerCase().repeat(40),
			}),
		);
		snapshots[label] = join(copy.dir, `snapshot-${label}`);
		await cp(join(copy.dir, "dist"), snapshots[label], { recursive: true });
	}
	server = createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		const pin = url.searchParams.get("dpl");
		const label = pin
			? Object.keys(IDS).find((key) => IDS[key] === pin)
			: current;
		if (!label) {
			response.writeHead(404);
			response.end();
			return;
		}
		const pathname = decodeURIComponent(url.pathname);
		try {
			const body = await readFile(
				join(
					snapshots[label],
					pathname.endsWith("/") ? `${pathname}index.html` : pathname,
				),
			);
			response.writeHead(200, {
				"Content-Type":
					MIME[extname(pathname)] ??
					(pathname.endsWith("/") ? "text/html" : "application/octet-stream"),
				"Cache-Control": "no-store",
			});
			response.end(body);
		} catch (error) {
			if (error.code !== "ENOENT") {
				response.destroy(error);
				return;
			}
			response.writeHead(404);
			response.end("not found");
		}
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch();
});

afterAll(async () => {
	await browser?.close();
	if (server?.listening)
		await new Promise((resolve) => {
			server.closeAllConnections();
			server.close(resolve);
		});
	await copy?.remove();
});

it("actual pinned builds cover portfolio, blog and recipe entrypoints, stylesheets and CSS font requests", async () => {
	for (const route of ["", "about", "blog", "recipes/greek-turkey-patties"]) {
		// biome-ignore lint/performance/noAwaitInLoops: inspect each independently rendered route.
		const html = await readFile(join(snapshots.A, route, "index.html"), "utf8");
		const dom = new JSDOM(html);
		try {
			const resources = [
				...dom.window.document.querySelectorAll(
					"[src],link[href],astro-island",
				),
			]
				.flatMap((element) =>
					["src", "href", "component-url", "renderer-url"].map((name) =>
						element.getAttribute(name),
					),
				)
				.filter((value) => value?.startsWith("/_astro/"));
			assert.ok(resources.length > 2, route);
			for (const resource of resources)
				assert.equal(
					new URL(resource, origin).searchParams.get("dpl"),
					IDS.A,
					resource,
				);
			for (const resource of resources) {
				if (!new URL(resource, origin).pathname.endsWith(".css")) continue;
				// biome-ignore lint/performance/noAwaitInLoops: inspect actual stylesheets before releasing this DOM.
				const css = await readFile(
					join(snapshots.A, new URL(resource, origin).pathname),
					"utf8",
				);
				for (const match of css.matchAll(CSS_ASSET_URL))
					assert.equal(
						new URL(match.groups.url, origin).searchParams.get("dpl"),
						IDS.A,
						match.groups.url,
					);
			}
		} finally {
			dom.window.close();
		}
	}
});

it("an old real document loads its stylesheet and deferred module after B replaces A", {
	timeout: 60_000,
}, async () => {
	current = "B";
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		await stubOffOrigin(context, origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		const requested = [];
		page.on("request", (request) => requested.push(request.url()));
		const oldHtml = await readFile(
			join(snapshots.A, "retention-probe/index.html"),
			"utf8",
		);
		await page.route(`${origin}/retention-probe/`, (route) =>
			route.fulfill({ contentType: "text/html", body: oldHtml }),
		);
		await page.goto(`${origin}/retention-probe/`);
		await page.waitForFunction(
			() =>
				typeof window.loadRetentionProbe === "function" &&
				!document.querySelector("astro-island[ssr]"),
		);
		const before = requested.length;
		assert.equal(await page.evaluate(() => window.loadRetentionProbe()), "A");
		assert.equal(
			await page
				.locator(".retention-probe")
				.evaluate((element) => getComputedStyle(element).color),
			"rgb(10, 20, 30)",
		);
		const assets = requested.filter((value) =>
			new URL(value).pathname.startsWith("/_astro/"),
		);
		const later = requested
			.slice(before)
			.filter((value) => new URL(value).pathname.startsWith("/_astro/"));
		assert.ok(later.some((value) => new URL(value).pathname.endsWith(".js")));
		assert.ok(assets.some((value) => new URL(value).pathname.endsWith(".css")));
		assert.ok(
			assets.every((value) => new URL(value).searchParams.get("dpl") === IDS.A),
		);
		const lazy = later.find((value) => new URL(value).pathname.endsWith(".js"));
		const pinned = await context.request.get(lazy);
		const expected = await readFile(join(snapshots.A, new URL(lazy).pathname));
		assert.equal(hash(await pinned.body()), hash(expected));
		const control = await context.request.get(origin + new URL(lazy).pathname);
		assert.ok(
			control.status() === 404 || hash(await control.body()) !== hash(expected),
			"B must differ or omit this A module",
		);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});

it("a pinned recipe build installs, saves and reopens the actual cooking page offline after replacement", {
	timeout: 90_000,
}, async () => {
	current = "A";
	const context = await browser.newContext();
	try {
		await stubOffOrigin(context, origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		const route = "/recipes/greek-turkey-patties/";
		await page.goto(origin + route);
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.reload();
		await page.waitForFunction(
			() =>
				navigator.serviceWorker.controller &&
				!document.querySelector("astro-island[ssr]"),
		);
		await page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					const channel = new MessageChannel();
					channel.port1.onmessage = ({ data }) => {
						channel.port1.close();
						if (data.saved) resolve();
						else reject(new Error(data.error));
					};
					navigator.serviceWorker.controller.postMessage(
						{
							type: "SAVE_RECIPE",
							id: "greek-turkey-patties",
							release: "a".repeat(40),
						},
						[channel.port2],
					);
				}),
		);
		current = "B";
		await context.setOffline(true);
		await page.goto(origin + route);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.match(await page.locator("h1").textContent(), RECIPE_TITLE);
		const ingredient = page
			.locator(".recipe-detail .trn-ingredient")
			.filter({ hasText: "93%-lean ground turkey" });
		const originalAmount = await ingredient.textContent();
		await page.getByRole("combobox", { name: SERVINGS }).selectOption("2");
		assert.equal(new URL(page.url()).searchParams.get("servings"), "2");
		assert.notEqual(
			await ingredient.textContent(),
			originalAmount,
			"serving changes recalculate the offline ingredients",
		);
		await page
			.getByRole("button", {
				name: "Learn more about Tabular Recipe Notation",
				exact: true,
			})
			.click();
		await page.locator(".method-dialog").waitFor();
		await page
			.getByRole("button", { name: "Close and continue recipe" })
			.click();
		await page.locator(".method-dialog").waitFor({ state: "detached" });
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
