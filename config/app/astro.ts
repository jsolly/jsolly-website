import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import type { AstroConfig, AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import { deploymentAssetPin } from "../../scripts/vercel-static-assets.mjs";
import retiredRecipes from "../../src/components/recipes/retired-recipes.json" with {
	type: "json",
};
import { postLastmods } from "../../src/lib/blog/post-loader.js";
import retiredCategories from "../../src/lib/blog/retired-categories.json" with {
	type: "json",
};
import { astroCsp } from "../../src/lib/csp-policy.js";

// Astro builds these as dist/404.html and dist/500.html; they are not routes.
const ERROR_ROUTES = new Set(["/404/", "/500/"]);
const EDGE_SLASHES = /^\/+|\/+$/gu;
// Exclude noindex search, saved recipes and retirement notices.
// The integration already drops the 404 and 500 pages.
const SITEMAP_EXCLUDED = new Set([
	"/blog/search/",
	"/recipes/saved/",
	...retiredCategories.map(({ slug }) => `/blog/category/${slug}/`),
	...retiredRecipes.map(({ id }) => `/recipes/${id}/`),
]);
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

// Keep Vercel's existing static builder, API functions and routing middleware.
// Astro owns pinning HTML resources and generated inter-chunk imports.
function vercelStaticAssets(): AstroIntegration {
	const deploymentId = deploymentAssetPin(process.env);
	type AssetUrlRenderer = NonNullable<
		NonNullable<AstroConfig["vite"]["experimental"]>["renderBuiltUrl"]
	>;
	const renderBuiltUrl: AssetUrlRenderer = (filename, { type }) => {
		if (!deploymentId || type !== "asset" || !filename.startsWith("_astro/")) {
			return;
		}
		return `/${filename}?${new URLSearchParams({ dpl: deploymentId })}`;
	};
	return {
		name: "vercel-static-assets",
		hooks: {
			"astro:config:setup": ({ updateConfig }) => {
				if (!deploymentId) return;
				updateConfig({
					vite: {
						experimental: {
							// Cover Vite preload tables and CSS font/image references too.
							renderBuiltUrl,
						},
					},
				});
			},
			"astro:config:done": ({ config, setAdapter }) => {
				if (!deploymentId) return;
				if (config.output !== "static") {
					throw new Error("The website asset adapter requires static output.");
				}
				setAdapter({
					name: "vercel-static-assets",
					entrypointResolution: "auto",
					adapterFeatures: { buildOutput: "static" },
					supportedAstroFeatures: { staticOutput: "stable" },
					client: {
						assetQueryParams: new URLSearchParams({ dpl: deploymentId }),
					},
				});
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
		{
			name: "jsolly-website-config-watch",
			hooks: {
				"astro:config:setup": ({ addWatchFile }) => {
					addWatchFile(new URL("./astro.ts", import.meta.url));
				},
			},
		},
		svelte(),
		sitemap({
			customPages:
				process.env.NODE_ENV === "development"
					? ["http://localhost:4321/John-Solly-Resume.pdf"]
					: ["https://www.jsolly.com/John-Solly-Resume.pdf"],
			filter: (page) => {
				const path = new URL(page).pathname;
				return !SITEMAP_EXCLUDED.has(path);
			},
			// A post's lastmod is its frontmatter `updated`; no other page has one.
			serialize: (item) => {
				const lastmod = POST_LASTMODS.get(new URL(item.url).pathname);
				return lastmod ? { ...item, lastmod } : item;
			},
		}),
		routeManifest(),
		vercelStaticAssets(),
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
		// Preview builds also allow the Vercel Toolbar (src/lib/csp-policy.ts).
		csp: astroCsp(process.env.VERCEL_ENV),
	},

	vite: {
		plugins: [tailwindcss()],
	},
});
