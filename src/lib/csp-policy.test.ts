import assert from "node:assert/strict";
import { it } from "vitest";
import vercelConfig from "../../vercel.json" with { type: "json" };
import {
	astroCsp,
	previewResponseHeaders,
	siteHeaderPolicy,
	VERCEL_TOOLBAR_SOURCES,
} from "./csp-policy.js";

// The reviewed production meta policy: same-origin only, plus Astro's hashes.
const PRODUCTION = {
	directives: ["default-src 'self'"],
	styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
};

it("keeps the production meta policy outside Vercel Preview builds", () => {
	for (const env of [undefined, "", "production", "development", "Preview"]) {
		assert.deepEqual(astroCsp(env), PRODUCTION, `VERCEL_ENV=${env}`);
	}
});

it("adds exactly the Vercel Toolbar sources to Preview builds", () => {
	const csp = astroCsp("preview");
	const directives = new Map(
		(csp.directives ?? []).map((directive) => {
			const [name, ...sources] = directive.split(" ");
			return [name, sources];
		}),
	);
	directives.set("script-src", csp.scriptDirective?.resources ?? []);
	directives.set("style-src", csp.styleDirective?.resources ?? []);

	assert.deepEqual(directives.get("default-src"), ["'self'"]);
	for (const [name, sources] of Object.entries(VERCEL_TOOLBAR_SOURCES)) {
		assert.deepEqual(
			directives.get(name)?.toSorted(),
			[...new Set(["'self'", ...sources])].toSorted(),
			name,
		);
	}
	assert.deepEqual(
		[...directives.keys()].toSorted(),
		["default-src", ...Object.keys(VERCEL_TOOLBAR_SOURCES)].toSorted(),
		"no other directive changes",
	);
});

it("middleware adds no header outside Vercel Preview deployments", () => {
	for (const env of [undefined, "", "production", "development", "Preview"]) {
		assert.deepEqual(previewResponseHeaders(env, vercelConfig), {}, `${env}`);
	}
});

it("Preview deployments widen only the header directives the toolbar needs", () => {
	const header = previewResponseHeaders("preview", vercelConfig)[
		"Content-Security-Policy"
	];
	assert.equal(
		header,
		[
			"img-src 'self' data: https://vercel.live https://vercel.com blob:",
			"style-src 'self' 'unsafe-inline' https://vercel.live",
			"font-src 'self' https://vercel.live https://assets.vercel.com",
			"base-uri 'self'",
			"form-action 'self'",
			"object-src 'none'",
			"frame-ancestors 'self'",
			"upgrade-insecure-requests",
		].join("; "),
	);
});

it("the site header policy must be the one vercel.json policy on every route", () => {
	const rule = (source: string) => ({
		source,
		headers: [{ key: "Content-Security-Policy", value: "img-src 'self'" }],
	});
	assert.equal(
		siteHeaderPolicy({ headers: [rule("/(.*)")] }),
		"img-src 'self'",
	);
	for (const headers of [
		[],
		[rule("/blog/(.*)")],
		[rule("/(.*)"), rule("/(.*)")],
	]) {
		assert.throws(() => siteHeaderPolicy({ headers }), /exactly one/u);
	}
});
