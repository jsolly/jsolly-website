import assert from "node:assert/strict";
import { resolve } from "node:path";
import { globby } from "globby";
import { it } from "vitest";
import { builtPages, SAMPLE } from "../accessibility-pages.mjs";
import { DIST } from "./pages.mjs";

// PR CI audits only SAMPLE; the full audit runs after merge and daily.
it("every sampled accessibility route is a page the full audit scans", async () => {
	const pages = new Set(await builtPages(resolve(DIST)));
	const routes = SAMPLE.map(({ route }) => route);
	assert.equal(new Set(routes).size, routes.length, "Duplicate sampled route");
	assert.deepEqual(
		routes.filter((route) => !pages.has(route)),
		[],
		"Sampled routes missing from dist/: update SAMPLE in scripts/accessibility-pages.mjs",
	);
});

it("the accessibility sample covers every HTML page template", async () => {
	const templates = await globby("src/pages/**/*.astro");
	assert.deepEqual(
		new Set(SAMPLE.map(({ template }) => template)),
		new Set(templates),
		"Each src/pages template needs a sampled route in scripts/accessibility-pages.mjs",
	);
});
