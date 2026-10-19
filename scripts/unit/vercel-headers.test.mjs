import assert from "node:assert/strict";
import { it } from "vitest";
import { PWA_WORKER_PATH } from "../../src/components/recipes/constants.mjs";
import { FEEDS } from "../../src/lib/blog/constants.js";
import { rootVercelRoutes, routePath } from "../blogthedata-redirects.mjs";

// Headers a static build cannot set, which only vercel.json gives: the feeds'
// XML types (plan §4.7) and the recipe service worker's no-cache. The root
// config compiles with Vercel's own routing-utils, as the legacy redirect
// project's does.
const routes = rootVercelRoutes();

it("Vercel serves each blog feed with its feed media type, unredirected and with the security headers", () => {
	for (const { path, type } of Object.values(FEEDS)) {
		const { redirect, headers } = routePath(routes, path);
		assert.equal(redirect, null, `${path} is served, not redirected`);
		assert.equal(headers["Content-Type"], `${type}; charset=utf-8`, path);
		assert.equal(headers["X-Content-Type-Options"], "nosniff", path);
	}
	assert.equal(
		routePath(routes, "/blog/").headers["Content-Type"],
		undefined,
		"blog pages keep Vercel's own HTML type",
	);
});

// The client registers with updateViaCache: "none", which skips the browser's
// HTTP cache on update checks; no-cache also keeps any other cache from
// answering with a stale worker, as the legacy kill-switch rules do (plan §5
// B18).
it("Vercel serves the recipe service worker uncached, unredirected and with the security headers", () => {
	const { redirect, headers } = routePath(routes, PWA_WORKER_PATH);
	assert.equal(redirect, null, `${PWA_WORKER_PATH} is served, not redirected`);
	assert.equal(headers["Cache-Control"], "no-cache");
	assert.equal(headers["X-Content-Type-Options"], "nosniff");
	assert.ok(headers["Content-Security-Policy"], "the header CSP applies");
	assert.equal(
		routePath(routes, "/recipes/").headers["Cache-Control"],
		undefined,
		"recipe pages keep Vercel's own caching",
	);
});
