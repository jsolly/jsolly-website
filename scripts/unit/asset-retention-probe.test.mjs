import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import {
	captureAssets,
	pinnedPageAssets,
	verifyAssets,
} from "../asset-retention-probe.mjs";

const PIN_ERROR = /pin|mixed deployments/u;
const BYTES_ERROR = /old deployment bytes changed/u;
const CONTROL_ERROR = /identical B bytes/u;
const HTML = `<html><head><link rel="stylesheet" href="/_astro/site.css?dpl=dpl_test_A">
<script>const inert = '<link rel="stylesheet" href="/_astro/inert.css">';</script>
<script src="/_astro/entry.js?dpl=dpl_test_A"></script></head><body>
<astro-island component-url="/_astro/component.js?dpl=dpl_test_A" renderer-url="/_astro/renderer.js?dpl=dpl_test_A"></astro-island>
<a href="/_astro/download.js">Download</a></body></html>`;

afterEach(() => vi.unstubAllGlobals());

it("production capture reads actual generated resource nodes without inert strings or download links", () => {
	assert.deepEqual(pinnedPageAssets(HTML), {
		deploymentId: "dpl_test_A",
		component: "/_astro/component.js?dpl=dpl_test_A",
		paths: ["component.js", "entry.js", "renderer.js", "site.css"].map(
			(name) => `/_astro/${name}?dpl=dpl_test_A`,
		),
	});
});

it("production capture refuses unpinned or mixed-deployment documents", () => {
	assert.throws(
		() => pinnedPageAssets(HTML.replaceAll("?dpl=dpl_test_A", "")),
		PIN_ERROR,
	);
	assert.throws(
		() =>
			pinnedPageAssets(
				HTML.replace("entry.js?dpl=dpl_test_A", "entry.js?dpl=dpl_test_B"),
			),
		PIN_ERROR,
	);
});

it("provider acceptance compares actual retained bytes and rejects an indistinguishable current-release control", async () => {
	const provider = {
		release: "A",
		retainedBody: "export const version = 'A';",
		currentBody: "export const version = 'B';",
	};
	const transport = vi.fn((input, options) => {
		assert.equal(options.cache, "no-store");
		assert.equal(options.redirect, "error");
		const url = new URL(input);
		assert.equal(url.origin, "https://www.jsolly.com");
		if (url.pathname === "/release.json")
			return Response.json({ sha: provider.release.toLowerCase().repeat(40) });
		if (url.pathname === "/about/") return new Response(HTML);
		if (url.pathname.startsWith("/_astro/")) {
			const pinned = url.searchParams.get("dpl") === "dpl_test_A";
			const body = url.pathname.endsWith(".css")
				? "body{color:red}"
				: pinned
					? provider.retainedBody
					: provider.currentBody;
			return new Response(body, {
				headers: {
					"content-type": url.pathname.endsWith(".css")
						? "text/css"
						: "text/javascript",
				},
			});
		}
		throw new Error(`Unexpected test request: ${url.pathname}`);
	});
	vi.stubGlobal("fetch", transport);
	const captured = await captureAssets();
	provider.release = "B";
	const receipt = await verifyAssets(captured);
	assert.equal(receipt.retained.length, 4);
	assert.equal(receipt.oldRelease, "a".repeat(40));
	assert.equal(receipt.currentRelease, "b".repeat(40));
	provider.retainedBody = "export const version = 'X';";
	await assert.rejects(verifyAssets(captured), BYTES_ERROR);
	provider.retainedBody = "export const version = 'A';";
	provider.currentBody = "export const version = 'A';";
	await assert.rejects(verifyAssets(captured), CONTROL_ERROR);
});
