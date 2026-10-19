import assert from "node:assert/strict";
import { it } from "vitest";
import { parseDirectives, readHeaderPolicy } from "../csp.mjs";

function sortedSources(directives) {
	return new Map(
		[...directives].map(([name, sources]) => [name, sources.toSorted()]),
	);
}

it("Vercel sends exactly the reviewed header policy to every route", async () => {
	const directives = parseDirectives(await readHeaderPolicy());
	assert.deepEqual(
		sortedSources(directives),
		sortedSources(
			new Map([
				// Legacy blog post images live on the retained blogthedata CloudFront host (J6).
				[
					"img-src",
					["'self'", "data:", "https://d1d7p8ufhgz4ld.cloudfront.net"],
				],
				["style-src", ["'self'", "'unsafe-inline'"]],
				["font-src", ["'self'"]],
				["base-uri", ["'self'"]],
				// form-action does not fall back to default-src, so only the header restricts it.
				["form-action", ["'self'"]],
				["object-src", ["'none'"]],
				// Same-origin only: blog posts frame their own notebook pages in /blog/notebooks/.
				["frame-ancestors", ["'self'"]],
				["upgrade-insecure-requests", []],
			]),
		),
		"a header directive was added, removed or widened without updating this review",
	);
});

it("Vercel leaves the script policy to the per-page Astro meta hashes", async () => {
	const directives = parseDirectives(await readHeaderPolicy());
	for (const name of ["script-src", "script-src-elem", "default-src"]) {
		assert.ok(
			!directives.has(name),
			`header ${name} would intersect with the Astro meta and block its script hashes`,
		);
	}
});
