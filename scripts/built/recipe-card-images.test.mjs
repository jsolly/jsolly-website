import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it } from "vitest";
import data from "../../src/components/recipes/recipe-data.server.mjs";
import { serveStatic } from "./pages.mjs";
import { holdRecipeArtifact } from "./recipe-artifact-gate.mjs";

it("background summaries preserve an in-flight card image on the existing element", {
	timeout: 30_000,
}, async ({ onTestFinished }) => {
	const site = await serveStatic("dist");
	let browser;
	let context;
	let summary;
	let imageOperation;
	const imageStarted = Promise.withResolvers();
	const releaseImage = Promise.withResolvers();
	onTestFinished(async () => {
		summary?.release();
		releaseImage.resolve();
		try {
			await imageOperation;
		} finally {
			await context?.close();
			await browser?.close();
			await site.close();
		}
	});
	browser = await chromium.launch();
	context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		serviceWorkers: "block",
	});
	const page = await context.newPage();
	const { image } = data.recipes.find((recipe) => recipe.type === "meal");
	const imagePaths = new Set([
		image.cardSrc,
		...image.cardSrcset
			.split(",")
			.map((candidate) => candidate.trim().split(" ")[0]),
	]);
	const requests = [];
	const failures = [];
	page.on("request", (request) => {
		if (imagePaths.has(new URL(request.url()).pathname)) requests.push(request);
	});
	page.on("requestfailed", (request) => {
		if (imagePaths.has(new URL(request.url()).pathname))
			failures.push(request.failure());
	});
	let held = false;
	await page.route(
		(url) => imagePaths.has(url.pathname),
		(route) => {
			if (held) return route.fallback();
			held = true;
			imageOperation = releaseImage.promise.then(() => route.continue());
			imageStarted.resolve();
			return imageOperation;
		},
	);
	summary = await holdRecipeArtifact(page, "summaries");
	await page.goto(`${site.origin}/recipes/meals/`, {
		waitUntil: "domcontentloaded",
	});
	await page.locator("[data-hydrated=true]").waitFor();
	await imageStarted.promise;
	await summary.started;
	const photo = page.locator(".recipe-card img.deferred-card-image").first();
	const original = await photo.elementHandle();
	summary.release();
	await summary.finished;
	await page.waitForFunction(
		() =>
			document.querySelector("#meal-results").getAttribute("aria-busy") ===
			"false",
	);
	assert.equal(
		await page.locator("#meal-results [role=alert]").count(),
		0,
		"summary replacement must succeed before image checks",
	);
	releaseImage.resolve();
	await imageOperation;
	await photo.evaluate((img) => img.decode());
	assert.equal(
		await photo.evaluate((img, previous) => img === previous, original),
		true,
	);
	assert.equal(
		requests.length,
		1,
		"unchanged image URLs keep their pending request",
	);
	assert.deepEqual(failures, []);
});
