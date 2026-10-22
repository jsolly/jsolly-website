import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
import { VERCEL_TOOLBAR_SOURCES } from "../../src/lib/csp-policy.js";
import { parseDirectives } from "../csp.mjs";
import {
	collectErrors,
	readBuiltPages,
	serveStatic,
	stubOffOrigin,
} from "./pages.mjs";
import { createTempCopy, requireSuccess } from "./temp-copy.mjs";

// Vercel runs the whole `npm run build`, csp suite included, with
// VERCEL_ENV=preview in the environment for Preview deployments. The gate
// builds production only, so this build is the one that proves a Preview build
// passes the csp suite.
let copy;
let dist;

beforeAll(async () => {
	copy = await createTempCopy("preview");
	requireSuccess(copy.npmRun("build", { VERCEL_ENV: "preview" }));
	dist = join(copy.dir, "dist");
});

afterAll(async () => {
	await copy?.remove();
});

it("Preview pages let the Vercel Toolbar through their meta policy", async () => {
	const pages = await readBuiltPages(dist);
	assert.ok(pages.length > 0, "built HTML is required");
	for (const { file, html } of pages) {
		const dom = new JSDOM(html);
		try {
			const meta = dom.window.document.head.querySelector(
				'meta[http-equiv="content-security-policy"]',
			);
			assert.ok(meta, `${file}: policy is in the head`);
			const directives = parseDirectives(meta.getAttribute("content"));
			for (const [name, sources] of Object.entries(VERCEL_TOOLBAR_SOURCES)) {
				for (const source of sources) {
					assert.ok(
						directives.get(name)?.includes(source),
						`${file}: ${name} allows ${source}`,
					);
				}
			}
		} finally {
			dom.window.close();
		}
	}
});

it("Preview recipe pages reload without installing an offline snapshot", async () => {
	let site;
	let browser;
	try {
		const pages = (await readBuiltPages(dist)).filter(({ file }) =>
			file.startsWith("recipes/"),
		);
		assert.ok(pages.length > 1);
		for (const { file, html } of pages) {
			assert.ok(!html.includes('id="recipe-offline-status"'), file);
		}
		site = await serveStatic(dist);
		browser = await chromium.launch();
		const page = await browser.newPage();
		const errors = collectErrors(page);
		await stubOffOrigin(page.context(), site.origin);
		await page.addInitScript(() => {
			window.previewRegistrationAttempts = 0;
			const original = navigator.serviceWorker.register.bind(
				navigator.serviceWorker,
			);
			navigator.serviceWorker.register = (...args) => {
				window.previewRegistrationAttempts++;
				return original(...args);
			};
		});
		await page.goto(`${site.origin}/recipes/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(
			await page.evaluate(() => window.previewRegistrationAttempts),
			0,
		);
		// A later build can be seen in the same open tab after a normal reload.
		const indexFile = join(dist, "recipes/index.html");
		const html = await readFile(indexFile, "utf8");
		await writeFile(
			indexFile,
			html.replace(
				"</head>",
				'<meta name="preview-update" content="next"></head>',
			),
		);
		await page.reload();
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		assert.equal(
			await page.locator('meta[name="preview-update"]').getAttribute("content"),
			"next",
		);
		assert.equal(
			await page.evaluate(() => window.previewRegistrationAttempts),
			0,
		);
		assert.equal(
			await page.evaluate(() => navigator.serviceWorker.controller),
			null,
		);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await site?.close();
	}
});
