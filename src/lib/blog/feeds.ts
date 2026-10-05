// The RSS and Atom feeds, built from the published posts. Pure: the endpoints
// (src/pages/blog/{rss,atom}.xml.ts) pass the posts and the Astro site.
import { escapeUTF8 as xml } from "entities";
import urlMap from "../../../legacy/blogthedata/url-map.json" with {
	type: "json",
};
import { FEED_SIZE, LEGACY_SITE } from "./constants.js";
import type { FeedPost } from "./types.js";
import { postHref } from "./urls.js";

const TITLE = "blogthedata | Blog";
const DESCRIPTION = "Latest blog posts from blogthedata";
// The Atom feed's id on the old host, unchanged so readers keep the feed (J8).
const ATOM_ID = new URL("/atom/", LEGACY_SITE).href;

// A post predates the merge when the legacy redirect map 301s an old page to
// it (a url-map.json "post" row): those rows are exactly the ported posts. Such
// a post keeps its old feed id, the row's own blogthedata.com URL, so readers
// do not see it again as new (J8). Posts written on jsolly.com have no row.
// Keyed by the post's path on this site, postHref(slug).
const LEGACY_IDS = new Map<string, string>();
for (const row of urlMap.rows) {
	if (row.class !== "post" || row.action !== "redirect-301") {
		continue;
	}
	if (row.destination === null) {
		throw new Error(`url-map.json post row ${row.id} has no destination`);
	}
	const path = new URL(row.destination).pathname;
	if (LEGACY_IDS.has(path)) {
		throw new Error(`url-map.json has two post rows for ${path}`);
	}
	LEGACY_IDS.set(path, new URL(row.source, LEGACY_SITE).href);
}

// The most recently updated posts; ties keep the given (newest published
// first) order.
function feedPosts(posts: FeedPost[]) {
	return posts
		.toSorted((a, b) => b.data.updated.getTime() - a.data.updated.getTime())
		.slice(0, FEED_SIZE);
}

function rssItem({ data }: FeedPost, link: string) {
	const legacyId = LEGACY_IDS.get(postHref(data.slug));
	// The old URL is no longer the permalink, so its guid says so.
	const guid =
		legacyId === undefined
			? `<guid isPermaLink="true">${link}</guid>`
			: `<guid isPermaLink="false">${legacyId}</guid>`;
	return `<item><title>${xml(data.title)}</title><link>${link}</link><description>${xml(data.description)}</description>${guid}</item>`;
}

function atomEntry({ data }: FeedPost, link: string) {
	const id = LEGACY_IDS.get(postHref(data.slug)) ?? link;
	return `<entry><title>${xml(data.title)}</title><link href="${link}" rel="alternate"/><id>${id}</id><summary type="html">${xml(data.description)}</summary><author><name>${xml(data.feedAuthor)}</name></author><updated>${data.published.toISOString()}</updated></entry>`;
}

// The feed document of `kind` for `posts` (the published posts), with links
// on `site`.
export function feed(kind: "rss" | "atom", posts: FeedPost[], site: URL) {
	const latest = feedPosts(posts);
	const feedUrl = new URL(`/blog/${kind}.xml`, site).href;
	const items = latest.map((post) => {
		const link = new URL(postHref(post.data.slug), site).href;
		return kind === "rss" ? rssItem(post, link) : atomEntry(post, link);
	});
	const updated = (latest[0]?.data.updated ?? new Date(0)).toISOString();
	return kind === "rss"
		? `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(TITLE)}</title><link>${feedUrl}</link><description>${DESCRIPTION}</description>${items.join("")}</channel></rss>`
		: `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${xml(TITLE)}</title><subtitle>${DESCRIPTION}</subtitle><id>${ATOM_ID}</id><link href="${feedUrl}" rel="self"/><updated>${updated}</updated>${items.join("")}</feed>`;
}
