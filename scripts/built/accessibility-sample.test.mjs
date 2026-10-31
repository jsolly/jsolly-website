import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { globby } from "globby";
import { it } from "vitest";
import recipeData from "../../src/components/recipes/recipes.json" with {
	type: "json",
};
import retiredRecipes from "../../src/components/recipes/retired-recipes.json" with {
	type: "json",
};
import retiredCategories from "../../src/lib/blog/retired-categories.json" with {
	type: "json",
};
import { builtPages, SAMPLE } from "../accessibility-pages.mjs";
import { auditOutcome } from "../accessibility-report.mjs";
import { allPosts, DIST } from "./pages.mjs";

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

// Templates that render distinct variants keep one sampled route per variant.
it("the accessibility sample keeps each recipe and category page variant", () => {
	const routesOf = (template) =>
		SAMPLE.filter((entry) => entry.template === template).map(
			({ route }) => route,
		);
	const slug = (route) => route.split("/").at(-2);
	const recipes = routesOf("src/pages/recipes/[slug].astro").map(slug);
	const originals = new Set(
		recipeData.recipes
			.map(({ id }) => id)
			.filter((id) => !id.startsWith("source-")),
	);
	const sources = new Set(
		recipeData.recipes
			.map(({ id }) => id)
			.filter((id) => id.startsWith("source-")),
	);
	const retired = new Set(retiredRecipes.map(({ id }) => id));
	assert.deepEqual(
		[originals, sources, retired].map(
			(variant) => recipes.filter((id) => variant.has(id)).length,
		),
		[1, 1, 1],
		`Recipe sample ${recipes.join(", ")} needs one original, one source- and one retired recipe`,
	);
	assert.equal(recipes.length, 3);
	const categories = routesOf("src/pages/blog/category/[slug].astro").map(slug);
	const retiredSlugs = new Set(retiredCategories.map(({ slug: s }) => s));
	assert.deepEqual(
		[
			categories.filter((c) => !retiredSlugs.has(c)).length,
			categories.filter((c) => retiredSlugs.has(c)).length,
		],
		[1, 1],
		`Category sample ${categories.join(", ")} needs one active and one retired category`,
	);
});

// Post variants come from the post files, not from SAMPLE's comments.
const IFRAME = /<iframe[\s>]/u;
const SECTION_HEADING = /^#{2,3} /mu;
it("the accessibility sample keeps a post with headings and an iframe, and one with an image attribution", async () => {
	const posts = new Map((await allPosts()).map((post) => [post.slug, post]));
	const sampled = SAMPLE.filter(
		({ template }) => template === "src/pages/blog/[slug].astro",
	).map(({ route }) => posts.get(route.split("/").at(-2)));
	assert.ok(sampled.every(Boolean), "Every sampled post route is a post file");
	assert.ok(
		sampled.some(({ body }) => IFRAME.test(body) && SECTION_HEADING.test(body)),
		"The sample needs a post with h2/h3 headings and an iframe embed",
	);
	assert.ok(
		sampled.some(({ imageAttribution }) => imageAttribution !== ""),
		"The sample needs a post whose hero image has an attribution caption",
	);
});

// The real audit, on one page, writes results the reporter accepts.
const SAMPLE_WITH_ROUTES = /--sample takes no route arguments/u;
it("the audit's results file passes the reporter's checks, and --sample takes no routes", (t) => {
	const root = mkdtempSync(join(tmpdir(), "a11y-audit-test-"));
	t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	const output = join(root, "accessibility-results.json");
	const audit = (args) =>
		spawnSync(process.execPath, ["scripts/check-accessibility.mjs", ...args], {
			encoding: "utf8",
			env: { ...process.env, A11Y_RESULTS: output },
		});
	const rejected = audit(["--sample", "/about/"]);
	assert.equal(rejected.status, 1);
	assert.match(rejected.stderr, SAMPLE_WITH_ROUTES);
	assert.ok(!existsSync(output));

	const about = audit(["/about/"]);
	assert.equal(about.status, 0, about.stderr);
	const text = readFileSync(output, "utf8");
	assert.equal(JSON.parse(text).expected, 2);
	const { results, failure } = auditOutcome(text, "success", "4242");
	assert.equal(failure, null);
	assert.deepEqual(
		results.map(({ path, width }) => `${width} ${path}`).sort(),
		["1280 /about/", "390 /about/"],
	);
});
