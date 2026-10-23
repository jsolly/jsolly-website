import assert from "node:assert/strict";
import { it } from "vitest";
import { maintenanceHtmlFacts } from "../built/maintenance-html.mjs";

it("maintenance facts retain decoded main text, manifest and every BlogPosting", () => {
	assert.deepEqual(
		maintenanceHtmlFacts(
			`<!doctype html><link rel="MANIFEST" href="/recipes/app.webmanifest"><main> Under\n <b>Maintenance &amp; recovery</b> <!--ignored--><noscript> Fallback</noscript></main><script type="APPLICATION/LD+JSON">{"@type":"BlogPosting"}</script><script type="application/ld+json">{"@type":"WebSite"}</script>`,
		),
		{
			main: "Under Maintenance & recovery Fallback",
			manifest: "/recipes/app.webmanifest",
			blogPostings: 1,
		},
	);
});

it("maintenance facts exclude inert templates and preserve missing and empty attributes", () => {
	assert.deepEqual(
		maintenanceHtmlFacts(
			`<!doctype html><template><main>Inert</main><link rel="manifest" href="wrong"><script type="application/ld+json">broken</script></template>`,
		),
		{
			main: null,
			manifest: undefined,
			blogPostings: 0,
		},
	);
	// biome-ignore lint/security/noSecrets: public HTML fixture, not credential material.
	assert.equal(maintenanceHtmlFacts('<link rel="manifest">').manifest, null);
	assert.equal(
		maintenanceHtmlFacts('<link rel="manifest" href="">').manifest,
		"",
	);
});

it("maintenance JSON matching respects foreign case and rejects malformed matching data", () => {
	assert.equal(
		maintenanceHtmlFacts(
			// biome-ignore lint/security/noSecrets: public HTML fixture, not credential material.
			'<svg><script type="APPLICATION/LD+JSON">broken</script><script type="application/ld+json">{"@type":"BlogPosting"}</script></svg>',
		).blogPostings,
		1,
	);
	assert.throws(
		() =>
			maintenanceHtmlFacts(
				// biome-ignore lint/security/noSecrets: malformed public JSON-LD fixture.
				'<script type="application/ld+json">broken</script>',
			),
		SyntaxError,
	);
});
