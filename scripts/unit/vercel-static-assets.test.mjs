import assert from "node:assert/strict";
import { it } from "vitest";
import {
	deploymentAssetPin,
	pinStylesheets,
} from "../vercel-static-assets.mjs";

const SKEW_PROTECTION = /Skew Protection/u;
const DEPLOYMENT_ID = /VERCEL_DEPLOYMENT_ID/u;

it("local builds stay portable while hosted builds refuse missing retention prerequisites", () => {
	assert.equal(deploymentAssetPin({}), undefined);
	assert.throws(() => deploymentAssetPin({ VERCEL: "1" }), SKEW_PROTECTION);
	assert.throws(
		() =>
			deploymentAssetPin({ VERCEL: "1", VERCEL_SKEW_PROTECTION_ENABLED: "1" }),
		DEPLOYMENT_ID,
	);
	assert.equal(
		deploymentAssetPin({
			VERCEL: "1",
			VERCEL_SKEW_PROTECTION_ENABLED: "1",
			VERCEL_DEPLOYMENT_ID: "dpl_fixture_A",
		}),
		"dpl_fixture_A",
	);
});

it("stylesheet pinning preserves executable bytes, hydration markers and unrelated resource URLs", () => {
	const script =
		'<script>const text = "<link rel=stylesheet href=/_astro/not-real.css>";</script>';
	const html = `<!doctype html><html><head>${script}<link rel="stylesheet" href="/_astro/main.css"></head><body><!--[--><noscript><link rel="STYLESHEET" href='/_astro/fallback.css'></noscript><!--]--><link rel="stylesheet" href="https://other.invalid/remote.css"><a href="/_astro/main.css">Download</a></body></html>`;
	assert.equal(pinStylesheets(html), html);
	const pinned = pinStylesheets(html, "dpl_fixture_A");
	// nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- Assertion checks preservation of a fixed script fixture in generated HTML.
	assert.ok(pinned.includes(script));
	assert.ok(pinned.includes('href="/_astro/main.css?dpl=dpl_fixture_A"'));
	assert.ok(pinned.includes('href="/_astro/fallback.css?dpl=dpl_fixture_A"'));
	assert.ok(pinned.includes('href="https://other.invalid/remote.css"'));
	assert.ok(pinned.includes('<a href="/_astro/main.css">Download</a>'));
	assert.ok(pinned.includes("<!--[-->"));
	assert.ok(pinned.includes("<!--]-->"));
	assert.equal(pinStylesheets(pinned, "dpl_fixture_A"), pinned);
});
