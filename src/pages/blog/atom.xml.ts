import type { APIRoute } from "astro";
import { blogContent } from "../../lib/blog/content.js";
import { feed } from "../../lib/blog/feeds.js";

// The static build drops this header; vercel.json sends the same Content-Type.
export const GET: APIRoute = async ({ site }) => {
	if (!site) {
		throw new Error("blog/atom.xml: set `site` in astro.config.ts");
	}
	const { posts } = await blogContent();
	return new Response(feed("atom", posts, site), {
		headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
	});
};
