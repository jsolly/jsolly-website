import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import axe from "axe-core";
import { chromium } from "playwright";
import { builtPages, SAMPLE } from "./accessibility-pages.mjs";

// Scan every built HTML document. `--sample` scans the PR CI sample instead;
// route arguments scan only those routes.
const root = resolve("dist");
const args = process.argv.slice(2);
if (args.includes("--sample") && args.length > 1)
	throw new Error("--sample takes no route arguments");
const pages =
	args[0] === "--sample"
		? SAMPLE.map(({ route }) => route)
		: args.length
			? args
			: await builtPages(root);
if (!pages.length)
	throw new Error("No HTML pages found. Run npm run build first.");
const mime = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
	try {
		let path = resolve(
			root,
			`.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`,
		);
		if (path !== root && !path.startsWith(root + sep))
			throw new Error("Invalid path");
		if ((await stat(path)).isDirectory()) path = join(path, "index.html");
		res.setHeader(
			"Content-Type",
			mime[extname(path)] || "application/octet-stream",
		);
		res.end(await readFile(path));
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
async function auditPage(path, width) {
	// Each document owns its browser state. Baseline DOM checks do not install
	// workers or carry saved recipes, preferences, or module requests between pages.
	const context = await browser.newContext({
		viewport: { width, height: 900 },
		bypassCSP: true,
		serviceWorkers: "block",
	});
	try {
		// Avoid handling same-origin asset requests in this audit's route callback.
		await context.route(
			(url) => url.origin !== origin,
			(route) => route.abort(),
		);
		const page = await context.newPage();
		const response = await page.goto(origin + path, { waitUntil: "load" });
		if (!response?.ok())
			throw new Error(`Failed to load ${path}: ${response?.status()}`);
		try {
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
		} catch (error) {
			const pending = await page
				.locator("astro-island[ssr]")
				.evaluateAll((nodes) =>
					nodes.map(
						(node) => node.getAttribute("component-url") ?? "<unknown>",
					),
				);
			throw new Error(
				`Hydration failed for ${width}px ${path}; pending islands: ${pending.join(", ")}`,
				{ cause: error },
			);
		}
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate(async () => {
			const finite = document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !== Infinity,
				);
			await Promise.all(
				finite.map((animation) => animation.finished.catch(() => undefined)),
			);
		});
		await page.evaluate(axe.source);
		const { violations, incomplete } = await page.evaluate(() =>
			window.axe.run(),
		);
		results.push({ path, width, violations, incomplete });
		process.stdout.write(
			`${width} ${path}: ${violations.length} violations, ${incomplete.length} need review\n`,
		);
	} finally {
		await context.close();
	}
}
// accessibility-results.json records every completed page-viewport, the number
// expected, and the error that stopped the audit, if any. The a11y workflow
// reports it through scripts/accessibility-report.mjs.
let failure;
try {
	browser = await chromium.launch({ headless: true });
	await Promise.all(
		[1280, 390].map(async (width) => {
			const queue = [...pages];
			async function nextPage() {
				if (!queue.length) return;
				await auditPage(queue.shift(), width);
				return nextPage();
			}
			await Promise.all(Array.from({ length: 4 }, nextPage));
		}),
	);
	if (results.length !== pages.length * 2)
		throw new Error(
			`Incomplete accessibility audit: ${results.length}/${pages.length * 2} page-viewports`,
		);
} catch (error) {
	failure = error;
	throw error;
} finally {
	await browser?.close();
	await new Promise((r) => server.close(r));
	await writeFile(
		"accessibility-results.json",
		JSON.stringify(
			{
				expected: pages.length * 2,
				error: failure ? String(failure.message ?? failure) : null,
				results,
			},
			null,
			2,
		),
	);
}
if (results.some((r) => r.violations.length)) process.exitCode = 1;
