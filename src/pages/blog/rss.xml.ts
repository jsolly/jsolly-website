import type { APIRoute } from "astro";
import urlMap from "../../../legacy/blogthedata/url-map.json" with {
	type: "json",
};
import { FEEDS } from "../../lib/blog/constants.js";
import { blogContent } from "../../lib/blog/content.js";
import { legacyFeedIds, rssFeed } from "../../lib/blog/feeds.js";

// The static build drops this Content-Type (vercel.json sends it in
// production); astro dev needs it, or it serves the feed as text/plain.
export const GET: APIRoute = async ({ site }) => {
	if (!site) {
		throw new Error("blog/rss.xml: set `site` in astro.config.ts");
	}
	const { posts } = await blogContent();
	return new Response(rssFeed(posts, site, legacyFeedIds(urlMap.rows)), {
		headers: { "Content-Type": `${FEEDS.rss.type}; charset=utf-8` },
	});
};
