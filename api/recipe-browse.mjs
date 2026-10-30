import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseBrowseParams } from "../src/components/recipes/recipe-browse.mjs";
import { renderBrowseHTML } from "../src/components/recipes/recipe-browse-html.mjs";
import {
	browseLibraryPath,
	parseBrowseLibrary,
} from "../src/components/recipes/recipe-browse-library.mjs";
import {
	browseLibraryState,
	browseSearchPath,
	parseBrowseSearch,
} from "../src/components/recipes/recipe-browse-search.mjs";
import { createBrowsePage } from "../src/components/recipes/recipe-summary.mjs";

import { preferredType } from "../src/lib/accept-negotiate.js";

const libraries = new Map();
function deployedLibrary(root, release, search = false) {
	const path = join(
		dirname(root),
		search ? browseSearchPath(release) : browseLibraryPath(release),
	);
	if (!libraries.has(path)) {
		const pending = readFile(path, "utf8").then((json) =>
			(search ? parseBrowseSearch : parseBrowseLibrary)(
				JSON.parse(json),
				release,
			),
		);
		libraries.set(path, pending);
		pending.catch(() => {
			if (libraries.get(path) === pending) libraries.delete(path);
		});
	}
	return libraries.get(path);
}

const STACK_FRAME = /^\s+at /u;
const STACK_QUERY = /[?#]/u;
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
		const library = await deployedLibrary(root, release);
		const recipes = library.recipes;
		const parsed = parseBrowseParams(params, page.collection, recipes);
		const state = browseLibraryState(
			parsed.query.trim() ? await deployedLibrary(root, release, true) : null,
			parsed,
		);
		if (wantsJSON)
			return respond(
				createBrowsePage(recipes, page.collection, state, release),
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
				recipes,
				page.collection,
				state,
				artifact.cards[state.settings.servings],
			),
		);
	} catch (error) {
		// Preserve code locations without logging request values or the raw error
		// message, which can include input excerpts from a parser.
		const stack =
			error instanceof Error && typeof error.stack === "string"
				? error.stack
						.split("\n")
						.slice(1)
						.filter((line) => STACK_FRAME.test(line))
						.map((line) => line.split(STACK_QUERY)[0])
						.slice(0, 12)
				: [];
		console.error(
			JSON.stringify({
				event: "recipe-browse-error",
				message: "Recipe browsing could not render the deployed collection.",
				stack,
			}),
		);
		return respond(
			"Recipe browsing is temporarily unavailable. Reload the collection to try again.",
			503,
		);
	}
}

export default { fetch: (request) => browseResponse(request) };
