import assert from "node:assert/strict";
import it from "node:test";
import { recipeBrowseDestination } from "./recipe-browse-route.mjs";

it("native browse rewrites only explicit collection GET/HEAD submissions and overwrites supplied path", () => {
	for (const path of ["/recipes/", "/recipes/meals/", "/recipes/smoothies/"]) {
		for (const method of ["GET", "HEAD"]) {
			const result = recipeBrowseDestination(
				new Request(
					`https://example.test${path}?browse=1&q=fish&path=/secrets`,
					{ method },
				),
			);
			assert.equal(result?.pathname, "/api/recipe-browse/");
			assert.equal(result?.searchParams.get("path"), path);
			assert.equal(result?.searchParams.get("q"), "fish");
		}
	}
	for (const path of [
		"/recipes/meals/",
		"/recipes/meals/?browse=0",
		"/recipes/meals.md?browse=1",
		"/recipes/data/recipe-library.json?browse=1",
		"/recipes/fish/?browse=1",
		"/api/recipe-browse/?browse=1",
	])
		assert.equal(
			recipeBrowseDestination(new Request(`https://example.test${path}`)),
			null,
		);
	assert.equal(
		recipeBrowseDestination(
			new Request("https://example.test/recipes/?browse=1", { method: "POST" }),
		),
		null,
	);
});
