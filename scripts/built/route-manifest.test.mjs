import assert from "node:assert/strict";
import it from "node:test";
import { globby } from "globby";
import { routeManifest } from "./pages.mjs";

const INDEX_SUFFIX = /index\.html$/u;
const ERROR_PAGES = new Set(["/404/", "/500/"]);

it("the route manifest middleware ships lists exactly the pages the build wrote to dist/", async () => {
	const routes = await routeManifest();
	const pages = (await globby("**/index.html", { cwd: "dist" }))
		.map((file) => `/${file.replace(INDEX_SUFFIX, "")}`)
		.filter((route) => !ERROR_PAGES.has(route));
	assert.deepEqual(
		new Set(routes),
		new Set(pages),
		"src/generated/route-manifest.js differs from the index.html pages in dist/",
	);
});
