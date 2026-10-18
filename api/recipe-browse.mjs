import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseBrowseParams } from "../src/components/recipes/recipe-browse.mjs";
import { renderBrowseHTML } from "../src/components/recipes/recipe-browse-html.mjs";
import data from "../src/components/recipes/recipe-data.server.mjs";
import { createBrowsePage } from "../src/components/recipes/recipe-summary.mjs";

import { preferredType } from "../src/lib/accept-negotiate.js";

const FULL_SHA = /^[a-f0-9]{40}$/u;
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
	fragmentRoot = join(process.cwd(), ".recipe-browse"),
) {
	const url = new URL(request.url);
	const page = PAGES.get(url.searchParams.get("path"));
	const wantsJSON = (request.headers.get("accept") || "")
		.split(",")
		.some((type) => {
			const [media, ...parameters] = type.trim().toLowerCase().split(";");
			const quality = parameters.find((part) => part.trim().startsWith("q="));
			return (
				media === "application/json" &&
				(!quality || Number(quality.trim().slice(2)) > 0)
			);
		});
	const headers = wantsJSON
		? { ...HEADERS, "Content-Type": "application/json; charset=utf-8" }
		: HEADERS;
	const respond = (body, status = 200, extraHeaders = {}) =>
		new Response(
			request.method === "HEAD"
				? null
				: wantsJSON
					? JSON.stringify(typeof body === "string" ? { error: body } : body)
					: body,
			{ status, headers: { ...headers, ...extraHeaders } },
		);
	if (!page) return respond("Unknown recipe collection.", 404);
	if (!["GET", "HEAD"].includes(request.method))
		return respond("Method not allowed.", 405, { Allow: "GET, HEAD" });
	if (url.search.length > 8192)
		return respond("Recipe filters are too long.", 414);
	if (
		!wantsJSON &&
		preferredType(request.headers.get("accept")) !== "text/html"
	)
		return respond("This view requires HTML or JSON.", 406);
	try {
		if (process.env.MAINTENANCE_MODE === "true")
			return respond(
				wantsJSON
					? "Recipe browsing is temporarily unavailable."
					: await readFile(join(root, page.file), "utf8"),
				503,
			);
		const { sha: release } = JSON.parse(
			await readFile(join(dirname(root), "release.json"), "utf8"),
		);
		if (!FULL_SHA.test(release))
			throw new Error("Recipe browse release is missing or invalid.");
		const expectedRelease = url.searchParams.get("release");
		if (expectedRelease && expectedRelease !== release)
			return respond(
				wantsJSON
					? {
							error: "Recipes have updated. Reload the collection to continue.",
							release,
						}
					: "Recipes have updated. Reload the collection to continue.",
				409,
			);
		const params = new URLSearchParams(url.searchParams);
		if (params.get("shuffle") === "1") {
			params.set("seed", randomBytes(8).toString("hex"));
			params.set("page", "1");
		}
		const state = parseBrowseParams(params, page.collection, data.recipes);
		if (wantsJSON)
			return respond(
				createBrowsePage(data.recipes, page.collection, state, release),
			);
		const [html, artifact] = await Promise.all([
			readFile(join(root, page.file), "utf8"),
			readFile(join(fragmentRoot, `${page.collection}.json`), "utf8").then(
				JSON.parse,
			),
		]);
		if (artifact.release !== release)
			throw new Error("Recipe browse fragments belong to another release.");
		return respond(
			renderBrowseHTML(
				html,
				data.recipes,
				page.collection,
				state,
				artifact.cards[state.settings.servings],
			),
		);
	} catch (error) {
		console.error(
			"Recipe browsing could not render the deployed collection.",
			error instanceof Error ? error.message : "Unknown error",
		);
		return respond(
			"Recipe browsing is temporarily unavailable. Reload the collection to try again.",
			503,
		);
	}
}

export default { fetch: (request) => browseResponse(request) };
