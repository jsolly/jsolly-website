import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { it } from "vitest";
import { launchTestBrowser } from "../network/browser.js";
import {
	observeReleaseChecks,
	waitForReleaseChecks,
} from "./site-update-observer.js";

it("Release-check observer waits for native JSON completion and watcher cleanup before clock changes", async () => {
	const source = await readFile("src/lib/website-update.mjs", "utf8");
	let held: ServerResponse | undefined;
	let requests = 0;
	const metadata = JSON.stringify({ sha: "a".repeat(40) });
	const server = createServer((request, response) => {
		if (request.url === "/release.json") {
			requests++;
			response.writeHead(200, { "Content-Type": "application/json" });
			if (requests === 1) {
				held = response;
				response.flushHeaders();
			} else response.end(metadata);
		} else if (request.url === "/website-update.mjs") {
			response.writeHead(200, { "Content-Type": "text/javascript" });
			response.end(source);
		} else {
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(`<!doctype html><body data-completed="0"><script type="module">
import { readRelease, watchConnectedUpdates } from "/website-update.mjs";
watchConnectedUpdates(async (signal) => {
  try { await readRelease(signal); return true; }
  catch { return false; }
  finally { document.body.dataset.completed = String(Number(document.body.dataset.completed) + 1); }
});
</script>`);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const origin = `http://127.0.0.1:${address.port}`;
	let browser: Awaited<ReturnType<typeof launchTestBrowser>> | undefined;
	try {
		browser = await launchTestBrowser();
		const context = await browser.newContext({ serviceWorkers: "block" });
		try {
			const page = await context.newPage();
			await observeReleaseChecks(page);
			await page.clock.install();
			const headers = page.waitForResponse("**/release.json");
			await page.goto(origin);
			await headers;
			assert.ok(
				held,
				"the first response has sent headers but retains its body",
			);
			const settled = waitForReleaseChecks(page);
			assert.equal(
				await page.evaluate(async () => {
					await new Promise<void>((resolve) => {
						const channel = new MessageChannel();
						channel.port1.onmessage = () => {
							channel.port1.close();
							channel.port2.close();
							resolve();
						};
						channel.port2.postMessage(null);
					});
					return window.__releaseObserver.pending;
				}),
				1,
				"headers alone cannot release the check's pending body",
			);
			assert.equal(
				await page.locator("body").getAttribute("data-completed"),
				"0",
			);
			held.end(metadata);
			await settled;
			assert.equal(
				await page.locator("body").getAttribute("data-completed"),
				"1",
			);
			const next = page.waitForResponse("**/release.json");
			await page.clock.fastForward(35 * 60_000);
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await next;
			await waitForReleaseChecks(page);
			assert.equal(
				requests,
				2,
				"the actual watcher lock permits the next check",
			);
			assert.equal(
				await page.locator("body").getAttribute("data-completed"),
				"2",
			);
		} finally {
			await context.close();
		}
	} finally {
		try {
			await browser?.close();
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	}
});
