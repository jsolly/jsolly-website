// The RSS and Atom feeds, built from the published posts. Pure: the endpoints
// (src/pages/blog/{rss,atom}.xml.ts) pass the posts, the Astro site and the
// legacy ids from legacy/blogthedata/url-map.json.
import { escapeUTF8 as xml } from "entities";
import { FEED_SIZE, FEEDS, LEGACY_SITE } from "./constants.js";
import type { FeedPost, LegacyRow } from "./types.js";
import { postHref } from "./urls.js";

const TITLE = "blogthedata | Blog";
const DESCRIPTION = "Latest blog posts from blogthedata";
// The Atom feed's id on the old host, unchanged so readers keep the feed (J8).
const ATOM_ID = new URL("/atom/", LEGACY_SITE).href;

// The old feed ids of the posts that predate the merge, keyed by each post's
// path on this site (postHref). A post predates the merge when the legacy
// redirect map 301s an old page to it (a url-map.json "post" row): those rows
// are exactly the ported posts. Such a post keeps its old feed id, the row's
// own blogthedata.com URL, so readers do not see it again as new (J8). Posts
// written on jsolly.com have no row.
export function legacyFeedIds(rows: LegacyRow[]) {
	const ids = new Map<string, string>();
	for (const row of rows) {
		if (row.class !== "post" || row.action !== "redirect-301") {
			continue;
		}
		if (row.destination === null) {
			throw new Error(`url-map.json post row ${row.id} has no destination`);
		}
		const path = new URL(row.destination).pathname;
		if (ids.has(path)) {
			throw new Error(`url-map.json has two post rows for ${path}`);
		}
		ids.set(path, new URL(row.source, LEGACY_SITE).href);
	}
	return ids;
}

// The most recently updated posts, then the newest published.
function feedPosts(posts: FeedPost[]) {
	return posts
		.toSorted(
			(a, b) =>
				b.data.updated.getTime() - a.data.updated.getTime() ||
				b.data.published.getTime() - a.data.published.getTime(),
		)
		.slice(0, FEED_SIZE);
}

// The listed posts, each with its link on `site` and its legacy id (or
// undefined for a post written on jsolly.com).
function feedItems(
	posts: FeedPost[],
	site: URL,
	legacyIds: Map<string, string>,
) {
	return feedPosts(posts).map(({ data }) => {
		const path = postHref(data.slug);
		return {
			data,
			link: new URL(path, site).href,
			legacyId: legacyIds.get(path),
		};
	});
}

export function rssFeed(
	posts: FeedPost[],
	site: URL,
	legacyIds: Map<string, string>,
) {
	const items = feedItems(posts, site, legacyIds).map(
		({ data, link, legacyId }) => {
			// The old URL is no longer the permalink, so its guid says so.
			const guid =
				legacyId === undefined
					? `<guid isPermaLink="true">${link}</guid>`
					: `<guid isPermaLink="false">${legacyId}</guid>`;
			return `<item><title>${xml(data.title)}</title><link>${link}</link><description>${xml(data.description)}</description>${guid}</item>`;
		},
	);
	const feedUrl = new URL(FEEDS.rss.path, site).href;
	return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(TITLE)}</title><link>${feedUrl}</link><description>${DESCRIPTION}</description>${items.join("")}</channel></rss>`;
}

export function atomFeed(
	posts: FeedPost[],
	site: URL,
	legacyIds: Map<string, string>,
) {
	const items = feedItems(posts, site, legacyIds);
	const entries = items.map(
		({ data, link, legacyId }) =>
			`<entry><title>${xml(data.title)}</title><link href="${link}" rel="alternate"/><id>${legacyId ?? link}</id><summary type="html">${xml(data.description)}</summary><author><name>${xml(data.feedAuthor)}</name></author><updated>${data.published.toISOString()}</updated></entry>`,
	);
	const feedUrl = new URL(FEEDS.atom.path, site).href;
	const updated = (items[0]?.data.updated ?? new Date(0)).toISOString();
	return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${xml(TITLE)}</title><subtitle>${DESCRIPTION}</subtitle><id>${ATOM_ID}</id><link href="${feedUrl}" rel="self"/><updated>${updated}</updated>${entries.join("")}</feed>`;
}
