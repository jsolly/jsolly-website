import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { remarkExternalAnchor } from "./src/remarkplugins/remark-external-anchor.mjs";
import { remarkReadingTime } from "./src/remarkplugins/remark-reading-time.mjs";

// https://astro.build/config
export default defineConfig({
	site:
		process.env.NODE_ENV === "development"
			? "http://localhost:4321"
			: "https://www.jsolly.com",

	markdown: {
		remarkPlugins: [remarkExternalAnchor, remarkReadingTime],
	},

	integrations: [
		sitemap({
			customPages:
				process.env.NODE_ENV === "development"
					? ["http://localhost:4321/John-Solly-Resume.pdf"]
					: ["https://www.jsolly.com/John-Solly-Resume.pdf"],
		}),
	],

	vite: {
		plugins: [tailwindcss()],
	},
});
