import assert from "node:assert/strict";
import { it } from "vitest";
import { savedVersionResponse } from "./saved-version-notice.mjs";

const OLDER_MARKDOWN_NOTICE = /^> This is a saved recipe/u;

it("older saved HTML gets a visible notice without changing cached bytes or scripts", async () => {
	const source =
		// biome-ignore lint/security/noSecrets: synthetic HTML fixture, not a credential.
		'<html><body><main id="main"><h1>Saved recipe</h1><script src="/old-runtime.js"></script></main></body></html>';
	const cached = new Response(source, {
		headers: {
			"content-type": "text/html",
			"content-length": String(source.length),
			etag: "old",
		},
	});
	const served = await savedVersionResponse(
		cached,
		"old",
		"current",
		"/recipes/test/",
	);
	const html = await served.text();
	assert.equal(await cached.text(), source);
	assert.ok(
		html.includes('<aside role="status" data-saved-recipe-version="older">'),
	);
	assert.ok(html.includes("saved recipe from an earlier version"));
	assert.ok(html.includes('<script src="/old-runtime.js"></script>'));
	assert.equal(served.headers.get("content-length"), null);
	assert.equal(served.headers.get("etag"), null);
	assert.equal(served.headers.get("content-type"), "text/html");
});

it("older saved Markdown is identified while current documents and recipe assets pass through", async () => {
	const markdown = new Response("# Saved recipe\n\nIngredients.");
	assert.match(
		await (
			await savedVersionResponse(markdown, "old", "current", "/recipes/test.md")
		).text(),
		OLDER_MARKDOWN_NOTICE,
	);
	assert.equal(await markdown.text(), "# Saved recipe\n\nIngredients.");
	await Promise.all(
		[
			["current", "/recipes/test/"],
			["old", "/recipes/data/packs/test.json"],
			["old", "/old-runtime.js"],
		].map(async ([release, path]) => {
			const response = new Response("unchanged");
			assert.equal(
				await savedVersionResponse(response, release, "current", path),
				response,
			);
		}),
	);
});
