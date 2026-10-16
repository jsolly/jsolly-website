// Build-time representations of the pages Astro actually published. Bodies
// stay in static files; the edge manifest contains only route-to-file pairs.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { escapeAttribute } from "entities";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import {
	documentMarkdown,
	recipeDocument,
} from "../src/components/recipes/recipe-export.mjs";
import data from "../src/components/recipes/recipes.json" with { type: "json" };
import { maintenanceMarkdown } from "../src/content/agent-pages.js";

const TRAILING_SLASHES = /\/+$/u;
const COMPLEX = "table, iframe, video, pre";
const RECIPE_QUERY_NOTE =
	"This is the canonical four-serving recipe in US measures. Servings, metric measures, optional sides and filters are browser controls on the HTML page; query parameters do not change this static Markdown document.";

/** Preserve authored complex HTML, code, destinations and fragment anchors. */
export function pageMarkdown(html) {
	const dom = new JSDOM(html);
	try {
		const { document } = dom.window;
		const canonical = document
			// biome-ignore lint/security/noSecrets: CSS selector, not a credential.
			.querySelector('link[rel="canonical"]')
			?.getAttribute("href");
		const main = document.querySelector("main");
		if (!canonical || !main)
			throw new Error("Markdown page needs canonical URL and main content");
		const page = new URL(canonical);
		const article = main.querySelector("article:has(.article-body)");
		const content = (article ?? main).cloneNode(true);
		for (const element of content.querySelectorAll(
			"script, style, noscript, button, form, .heading-link, .share-actions, [hidden]",
		))
			element.remove();
		for (const element of content.querySelectorAll("[href], [src], [poster]")) {
			for (const name of ["href", "src", "poster"]) {
				const value = element.getAttribute(name);
				if (value) element.setAttribute(name, new URL(value, page).href);
			}
		}
		// Markdown heading sluggers differ between readers. Explicit anchors
		// retain the IDs already chosen by the HTML renderer.
		for (const element of content.querySelectorAll("[id]")) {
			if (element.closest(COMPLEX)) continue;
			const anchor = document.createElement("a");
			anchor.id = element.id;
			element.before(anchor);
			element.removeAttribute("id");
		}
		const converter = new TurndownService({
			headingStyle: "atx",
			bulletListMarker: "-",
			codeBlockStyle: "fenced",
			blankReplacement: (_content, node) =>
				node.id
					? `<a id="${escapeAttribute(node.id)}"></a>`
					: node.isBlock
						? "\n\n"
						: "",
		});
		converter.addRule("fragmentAnchor", {
			filter: (node) =>
				node.nodeName === "A" && Boolean(node.id) && !node.getAttribute("href"),
			replacement: (_content, node) =>
				`\n\n<a id="${escapeAttribute(node.id)}"></a>\n\n`,
		});
		// Tables may have spanning cells and code may contain significant
		// whitespace. Keeping those elements avoids a lossy reconstruction.
		converter.addRule("authoredComplexContent", {
			filter: ["table", "iframe", "video", "pre"],
			replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
		});
		const structured = [
			...document.querySelectorAll('script[type="application/ld+json"]'),
		]
			.map((node) => JSON.parse(node.textContent))
			.find((entry) => entry["@type"] === "BlogPosting");
		const metadata = {
			canonical,
			title: content.querySelector("h1")?.textContent.trim() ?? document.title,
			description:
				document
					// biome-ignore lint/security/noSecrets: CSS selector, not a credential.
					.querySelector('meta[name="description"]')
					?.getAttribute("content") ?? "",
			...(structured
				? {
						author: structured.author.name,
						published: structured.datePublished,
						updated: structured.dateModified,
					}
				: {}),
		};
		const frontmatter = [
			"---",
			...Object.entries(metadata).map(
				([key, value]) => `${key}: ${JSON.stringify(value)}`,
			),
			"---",
		].join("\n");
		return `${frontmatter}\n\n${converter.turndown(content)}\n`;
	} finally {
		dom.window.close();
	}
}

export async function buildMarkdown(root, manifestPath) {
	const { routes } = await import(pathToFileURL(manifestPath).href);
	const pairs = [];
	const recipes = new Map(
		data.recipes.map((recipe) => [`/recipes/${recipe.id}/`, recipe]),
	);
	for (const route of routes.filter(
		(path) => path.startsWith("/blog/") || path.startsWith("/recipes/"),
	)) {
		const sibling = `${route.replace(TRAILING_SLASHES, "")}.md`;
		// biome-ignore lint/performance/noAwaitInLoops: bounded build pages are processed sequentially.
		const html = await readFile(join(root, route, "index.html"), "utf8");
		const recipe = recipes.get(route);
		let body;
		if (process.env.MAINTENANCE_MODE === "true") {
			body = maintenanceMarkdown("https://www.jsolly.com");
		} else if (recipe) {
			const image = recipe.image;
			const illustration = image
				? `<figure><img src="${escapeAttribute(new URL(image.src, "https://www.jsolly.com").href)}" alt="${escapeAttribute(image.alt)}"><figcaption>${escapeAttribute(image.caption)}</figcaption></figure>\n\n`
				: "";
			body = `<a id="${escapeAttribute(recipe.id)}"></a>\n\n${illustration}${documentMarkdown(recipeDocument(recipe))}\nCanonical page: https://www.jsolly.com${route}\n\n${RECIPE_QUERY_NOTE}\n`;
		} else {
			body = pageMarkdown(html);
			if (route === "/blog/search/" || route.startsWith("/recipes/")) {
				body +=
					"\nSearch, pagination and recipe filters run in the HTML page's browser controls. This static representation describes the default page; query parameters do not run those controls.\n";
			}
		}
		await writeFile(join(root, sibling), body, { flag: "wx" });
		pairs.push([route.replace(TRAILING_SLASHES, ""), sibling]);
	}
	await writeFile(
		manifestPath,
		`// Generated by astro build and markdown-build.mjs. Do not edit.\nexport const routes = ${JSON.stringify(routes)};\nexport const markdownRoutes = ${JSON.stringify(pairs)};\n`,
	);
	return pairs.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = process.argv[2] ?? "dist";
	const manifest = fileURLToPath(
		new URL("../src/generated/route-manifest.js", import.meta.url),
	);
	console.info(
		`Wrote ${await buildMarkdown(root, manifest)} Markdown page siblings.`,
	);
}
