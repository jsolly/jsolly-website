import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import { postLastmods } from "../../src/lib/blog/post-loader.js";

// Astro builds these as dist/404.html and dist/500.html; they are not routes.
const ERROR_ROUTES = new Set(["/404/", "/500/"]);
const EDGE_SLASHES = /^\/+|\/+$/gu;
// Exclude noindex search.
// The integration already drops the 404 and 500 pages.
const SITEMAP_EXCLUDED = "/blog/search/";
// Read once at config load, outside @astrojs/sitemap's serialize, whose
// try/catch would swallow a throw and leave the build green without a sitemap.
const POST_LASTMODS = await postLastmods(
	fileURLToPath(new URL("../../", import.meta.url)),
);

/**
 * Writes the gitignored src/generated/route-manifest.js from the pages this
 * build emitted, one `/path/` per page ("/" for the index). middleware.ts
 * uses the published route list; markdown-build.mjs adds static sibling pairs;
 * Vercel bundles the middleware after `npm run build`, so it gets this list.
 */
function routeManifest(): AstroIntegration {
	let output: URL | undefined;
	return {
		name: "route-manifest",
		hooks: {
			"astro:config:done": ({ config }) => {
				output = new URL("src/generated/route-manifest.js", config.root);
			},
			"astro:build:done": async ({ pages }) => {
				if (!output) throw new Error("route-manifest: config:done never ran");
				const routes = [
					...new Set(
						pages.map(({ pathname }) => {
							const path = pathname.replace(EDGE_SLASHES, "");
							return path === "" ? "/" : `/${path}/`;
						}),
					),
				]
					.filter((route) => !ERROR_ROUTES.has(route))
					.sort((a, b) => a.localeCompare(b, "en"));
				await mkdir(new URL(".", output), { recursive: true });
				await writeFile(
					output,
					`// Written by astro build (routeManifest in config/app/astro.ts). Do not edit.\nexport const routes = ${JSON.stringify(routes, null, "\t")};\n`,
				);
			},
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site:
		process.env.NODE_ENV === "development"
			? "http://localhost:4321"
			: "https://www.jsolly.com",
	trailingSlash: "always",
	prerenderConflictBehavior: "error",

	integrations: [
		svelte(),
		sitemap({
			customPages:
				process.env.NODE_ENV === "development"
					? ["http://localhost:4321/John-Solly-Resume.pdf"]
					: ["https://www.jsolly.com/John-Solly-Resume.pdf"],
			filter: (page) => {
				const path = new URL(page).pathname;
				return path !== SITEMAP_EXCLUDED;
			},
			// A post's lastmod is its frontmatter `updated`; no other page has one.
			serialize: (item) => {
				const lastmod = POST_LASTMODS.get(new URL(item.url).pathname);
				return lastmod ? { ...item, lastmod } : item;
			},
		}),
		routeManifest(),
	],

	// Prism highlights with classes; Shiki would emit inline style attributes
	// (plan §1.13, CSP).
	markdown: {
		processor: satteri({
			features: { smartPunctuation: false, gfm: false },
		}),
		syntaxHighlight: "prism",
	},

	// Astro 7's default "jsx" mode drops line-break whitespace next to elements,
	// gluing prose to inline links and code spans; `true` compresses losslessly.
	// scripts/built/inline-spacing.test.mjs guards the rendered text.
	compressHTML: true,

	// Astro hashes its generated island bootstrap in each built page.
	security: {
		csp: {
			directives: ["default-src 'self'"],
			styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
		},
	},

	vite: {
		plugins: [tailwindcss()],
	},
});
