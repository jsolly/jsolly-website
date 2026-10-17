import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBrowseParams } from "../src/components/recipes/recipe-browse.mjs";
import { renderBrowseHTML } from "../src/components/recipes/recipe-browse-html.mjs";
import data from "../src/components/recipes/recipes.json" with { type: "json" };

import { preferredType } from "../src/lib/accept-negotiate.js";

const PAGES = new Map([
	["/recipes/", { file: "index.html", collection: "meal" }],
	["/recipes/meals/", { file: "meals/index.html", collection: "meal" }],
	[
		"/recipes/smoothies/",
		{ file: "smoothies/index.html", collection: "smoothie" },
	],
]);
const HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Cache-Control": "no-store",
	"X-Robots-Tag": "noindex, follow",
	Vary: "Accept",
};

/** Only deployment-owned templates are read; no request host or path becomes a fetch/file URL. */
export async function browseResponse(
	request,
	root = join(process.cwd(), "dist/recipes"),
) {
	const url = new URL(request.url);
	const page = PAGES.get(url.searchParams.get("path"));
	if (!page)
		return new Response("Unknown recipe collection.", {
			status: 404,
			headers: HEADERS,
		});
	if (!["GET", "HEAD"].includes(request.method))
		return new Response("Method not allowed.", {
			status: 405,
			headers: { ...HEADERS, Allow: "GET, HEAD" },
		});
	if (url.search.length > 8192)
		return new Response("Recipe filters are too long.", {
			status: 414,
			headers: HEADERS,
		});
	if (preferredType(request.headers.get("accept")) !== "text/html")
		return new Response("This view requires HTML.", {
			status: 406,
			headers: HEADERS,
		});
	if (request.method === "HEAD")
		return new Response(null, {
			status: process.env.MAINTENANCE_MODE === "true" ? 503 : 200,
			headers: HEADERS,
		});
	try {
		const html = await readFile(join(root, page.file), "utf8");
		if (process.env.MAINTENANCE_MODE === "true")
			return new Response(html, { status: 503, headers: HEADERS });
		const params = new URLSearchParams(url.searchParams);
		if (params.get("shuffle") === "1")
			params.set("seed", randomBytes(8).toString("hex"));
		const state = parseBrowseParams(params, page.collection, data.recipes);
		return new Response(
			renderBrowseHTML(html, data.recipes, page.collection, state),
			{ headers: HEADERS },
		);
	} catch (error) {
		console.error(
			"Recipe browsing could not render the deployed collection.",
			error instanceof Error ? error.message : "Unknown error",
		);
		return new Response(
			"Recipe browsing is temporarily unavailable. Reload the collection to try again.",
			{ status: 503, headers: HEADERS },
		);
	}
}

export default { fetch: (request) => browseResponse(request) };
