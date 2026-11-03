import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import type { AxeResults } from "axe-core";
import axe from "axe-core";
import type { Browser } from "playwright";
import { launchTestBrowser } from "../tests/network/browser.ts";
import { PROXY_ENVIRONMENT_KEY } from "../tests/network/constants.ts";
import { installNodeNetworkGuard } from "../tests/network/node/guard.ts";
import { startLoopbackProxy } from "../tests/network/proxy.ts";
import { builtPages } from "./accessibility-pages.ts";
import { SAMPLE, WIDTHS } from "./constants.ts";

// Scan every built HTML document. `--sample` scans the PR CI sample instead;
// route arguments scan only those routes. A11Y_RESULTS names the results file
// (default accessibility-results.json).
const RESULTS_ENVIRONMENT_KEY = "A11Y_RESULTS";
const networkGuard = installNodeNetworkGuard();
const root = resolve("dist");
const output =
	process.env[RESULTS_ENVIRONMENT_KEY] ?? "accessibility-results.json";
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
const mime: Record<string, string> = {
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
			`.${decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)}`,
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
await new Promise<void>((resolveListen, reject) => {
	server.once("error", reject);
	server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
if (!address || typeof address === "string")
	throw new Error("Accessibility fixture did not bind a TCP port");
const origin = `http://127.0.0.1:${address.port}`;
const previousProxy = process.env[PROXY_ENVIRONMENT_KEY];
let proxy: Awaited<ReturnType<typeof startLoopbackProxy>> | undefined;
let browser: Browser | undefined;
type PageAudit = Pick<AxeResults, "violations" | "incomplete"> & {
	path: string;
	width: number;
};
const results: PageAudit[] = [];
async function auditPage(activeBrowser: Browser, path: string, width: number) {
	// Each document owns its browser state. Baseline DOM checks do not install
	// workers or carry saved recipes, preferences, or module requests between pages.
	const context = await activeBrowser.newContext({
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
		const { violations, incomplete } = await page.evaluate(() => axe.run());
		results.push({ path, width, violations, incomplete });
		process.stdout.write(
			`${width} ${path}: ${violations.length} violations, ${incomplete.length} need review\n`,
		);
	} finally {
		await context.close();
	}
}
// The results file records every completed page-viewport, the number
// expected, and the error that stopped the audit, if any. The a11y workflow
// reports it through monitoring/accessibility-report.mjs.
const failures: unknown[] = [];
try {
	proxy = await startLoopbackProxy({ allowedPorts: new Set([address.port]) });
	process.env[PROXY_ENVIRONMENT_KEY] = proxy.endpoint;
	const launchedBrowser = await launchTestBrowser({ headless: true });
	browser = launchedBrowser;
	await Promise.all(
		WIDTHS.map(async (width) => {
			const queue = [...pages];
			async function nextPage(): Promise<void> {
				const path = queue.shift();
				if (path === undefined) return;
				await auditPage(launchedBrowser, path, width);
				return nextPage();
			}
			await Promise.all(Array.from({ length: 4 }, nextPage));
		}),
	);
	if (results.length !== pages.length * WIDTHS.length)
		throw new Error(
			`Incomplete accessibility audit: ${results.length}/${pages.length * WIDTHS.length} page-viewports`,
		);
} catch (error) {
	failures.push(error);
} finally {
	async function settle(operation: () => unknown): Promise<void> {
		try {
			await operation();
		} catch (error) {
			failures.push(error);
		}
	}
	await settle(() => browser?.close());
	await settle(() => proxy?.close());
	if (previousProxy === undefined) delete process.env[PROXY_ENVIRONMENT_KEY];
	else process.env[PROXY_ENVIRONMENT_KEY] = previousProxy;
	await settle(
		() =>
			new Promise<void>((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			}),
	);
	await settle(() => {
		const denials = proxy?.snapshot().denials ?? [];
		if (denials.length)
			throw new Error(
				`Accessibility browser network denied: ${JSON.stringify(denials)}`,
			);
	});
	await settle(() => networkGuard.assertNoExternalNetwork());
	await settle(() =>
		writeFile(
			output,
			JSON.stringify(
				{
					expected: pages.length * WIDTHS.length,
					error: failures.length ? failures.map(String).join("; ") : null,
					results,
				},
				null,
				2,
			),
		),
	);
}
if (failures.length)
	throw new AggregateError(failures, "Accessibility audit failed");
if (results.some((result) => result.violations.length)) process.exitCode = 1;
