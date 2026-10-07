import { mkdir, writeFile } from "node:fs/promises";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";

// Astro builds these as dist/404.html and dist/500.html; they are not routes.
const ERROR_ROUTES = new Set(["/404/", "/500/"]);
const EDGE_SLASHES = /^\/+|\/+$/gu;

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

	integrations: [
		svelte(),
		sitemap({
			customPages:
				process.env.NODE_ENV === "development"
					? ["http://localhost:4321/John-Solly-Resume.pdf"]
					: ["https://www.jsolly.com/John-Solly-Resume.pdf"],
		}),
		routeManifest(),
	],

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
