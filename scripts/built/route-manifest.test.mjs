import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import it from "node:test";
import { globby } from "globby";

const MANIFEST = new URL(
	"../../src/generated/route-manifest.js",
	import.meta.url,
);
const INDEX_SUFFIX = /index\.html$/u;
const ERROR_PAGES = new Set(["/404/", "/500/"]);

it("the route manifest middleware ships lists exactly the pages the build wrote to dist/", async () => {
	await access(MANIFEST);
	const { routes } = await import(MANIFEST.href);
	const pages = (await globby("**/index.html", { cwd: "dist" }))
		.map((file) => `/${file.replace(INDEX_SUFFIX, "")}`)
		.filter((route) => !ERROR_PAGES.has(route));
	assert.deepEqual(
		new Set(routes),
		new Set(pages),
		"src/generated/route-manifest.js differs from the index.html pages in dist/",
	);
});
