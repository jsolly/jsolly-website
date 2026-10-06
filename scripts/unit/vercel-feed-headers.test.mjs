import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import it from "node:test";
import { FEEDS } from "../../src/lib/blog/constants.js";
import { compileRoutes, routePath } from "../blogthedata-redirects.mjs";

// A static build drops an endpoint's headers, so only vercel.json gives the
// feeds their XML types (plan §4.7). The root config compiles with Vercel's
// own routing-utils, as the legacy redirect project's does. routePath ignores
// `has`, so the apex-host redirect (it only answers jsolly.com) stays out.
const config = JSON.parse(
	readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
);
const routes = compileRoutes({
	...config,
	redirects: config.redirects.filter((redirect) => !redirect.has),
});

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
