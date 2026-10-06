import { mkdir, writeFile } from "node:fs/promises";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import { postLastmods } from "./src/lib/blog/post-loader.js";

// Astro builds these as dist/404.html and dist/500.html; they are not routes.
const ERROR_ROUTES = new Set(["/404/", "/500/"]);
const EDGE_SLASHES = /^\/+|\/+$/gu;
// Pages the sitemap leaves out: the error pages and the noindex blog search.
// Everything else built is listed, /recipes/ pages included (J12).
const SITEMAP_EXCLUDED = new Set([...ERROR_ROUTES, "/blog/search/"]);
const POSTS = new URL("./src/content/blog/posts/", import.meta.url);
let lastmods: Promise<Map<string, string>> | undefined;

/**
 * Writes the gitignored src/generated/route-manifest.js from the pages this
 * build emitted, one `/path/` per page ("/" for the index). middleware.ts
 * imports it to tell real /blog/ and /recipes/ routes from unknown paths;
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
					`// Written by astro build (routeManifest in astro.config.ts). Do not edit.\nexport const routes = ${JSON.stringify(routes, null, "\t")};\n`,
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
			filter: (page) => !SITEMAP_EXCLUDED.has(new URL(page).pathname),
			// A post's lastmod is its frontmatter `updated`; no other page has one.
			serialize: async (item) => {
				lastmods ??= postLastmods(POSTS);
				const lastmod = (await lastmods).get(new URL(item.url).pathname);
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
