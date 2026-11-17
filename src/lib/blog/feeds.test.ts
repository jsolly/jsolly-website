import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { describe, it } from "vitest";
import { atomFeed, legacyFeedIds, rssFeed } from "./feeds.js";
import type { FeedPost, LegacyRow } from "./types.js";

// A host other than jsolly.com, so a hard-coded one would show.
const SITE = new URL("https://preview.example");
const HOSTILE = `Tips & tricks: <script>alert("x")</script> 'quoted'`;

// url-map.json rows as the redirect project records them: a ported post, a
// ported post whose old slug differs from its new one, a deleted post and a
// category (neither of the last two names a feed post).
const ROWS: LegacyRow[] = [
	{
		id: "PST-056",
		class: "post",
		action: "redirect-301",
		source: "/post/how-to-debug-an-astro-app/",
		destination: "https://www.jsolly.com/blog/how-to-debug-an-astro-app/",
	},
	{
		id: "PST-900",
		class: "post",
		action: "redirect-301",
		source: "/post/old-conventional-commits/",
		destination: "https://www.jsolly.com/blog/conventional-commits/",
	},
	{
		id: "PST-010",
		class: "post",
		action: "stays-404",
		source: "/post/geoasteroids/",
		destination: null,
	},
	{
		id: "CAT-001",
		class: "category",
		action: "redirect-301",
		source: "/category/Geodev/",
		destination: "https://www.jsolly.com/blog/category/Geodev/",
	},
];

function post(
	slug: string,
	updated: string,
	published = "2024-03-01T12:00:00Z",
	text = { title: `About ${slug}`, description: `What ${slug} covers` },
): FeedPost {
	return {
		data: {
			slug,
			...text,
			feedAuthor: "John_Solly",
			published: new Date(published),
			updated: new Date(updated),
		},
	};
}

// Parses a feed as XML (as HTML, <link> would be a void element).
function parse(xml: string) {
	const { document } = new JSDOM(xml, { contentType: "application/xml" })
		.window;
	if (document.querySelector("parsererror")) {
		throw new Error(`Not well-formed XML: ${xml}`);
	}
	return document;
}

// The direct child of the feed root named `tag`.
function rootChild(document: Document, tag: string) {
	return [...document.documentElement.children].find(
		(child) => child.tagName === tag,
	);
}

describe("blog feeds", () => {
	it("A ported post keeps its blogthedata guid and Atom id, and a post written on jsolly.com gets ids on the site", () => {
		const posts = [
			post("written-after-the-merge", "2026-10-04T09:00:00Z"),
			post("conventional-commits", "2026-10-03T09:00:00Z"),
			post("how-to-debug-an-astro-app", "2026-10-02T09:00:00Z"),
		];
		const legacyIds = legacyFeedIds(ROWS);
		const rss = parse(rssFeed(posts, SITE, legacyIds));
		assert.deepEqual(
			[...rss.querySelectorAll("item")].map((item) => {
				const guid = item.querySelector("guid");
				return {
					link: item.querySelector("link")?.textContent,
					guid: guid?.textContent,
					isPermaLink: guid?.getAttribute("isPermaLink"),
				};
			}),
			[
				{
					link: "https://preview.example/blog/written-after-the-merge/",
					guid: "https://preview.example/blog/written-after-the-merge/",
					isPermaLink: "true",
				},
				// Keyed by the row's destination, not its old slug.
				{
					link: "https://preview.example/blog/conventional-commits/",
					guid: "https://www.blogthedata.com/post/old-conventional-commits/",
					isPermaLink: "false",
				},
				{
					link: "https://preview.example/blog/how-to-debug-an-astro-app/",
					guid: "https://www.blogthedata.com/post/how-to-debug-an-astro-app/",
					isPermaLink: "false",
				},
			],
		);
		assert.equal(
			rss.querySelector("channel > link")?.textContent,
			"https://preview.example/blog/rss.xml",
		);

		const atom = parse(atomFeed(posts, SITE, legacyIds));
		assert.equal(
			rootChild(atom, "id")?.textContent,
			"https://www.blogthedata.com/atom/",
		);
		assert.equal(
			rootChild(atom, "link")?.getAttribute("href"),
			"https://preview.example/blog/atom.xml",
		);
		assert.deepEqual(
			[...atom.querySelectorAll("entry")].map((entry) => ({
				link: entry.querySelector("link")?.getAttribute("href"),
				id: entry.querySelector("id")?.textContent,
			})),
			[
				{
					link: "https://preview.example/blog/written-after-the-merge/",
					id: "https://preview.example/blog/written-after-the-merge/",
				},
				{
					link: "https://preview.example/blog/conventional-commits/",
					id: "https://www.blogthedata.com/post/old-conventional-commits/",
				},
				{
					link: "https://preview.example/blog/how-to-debug-an-astro-app/",
					id: "https://www.blogthedata.com/post/how-to-debug-an-astro-app/",
				},
			],
		);
	});

	it("Both feeds list the twenty most recently updated posts, the newest published first on a tie", () => {
		const posts = [
			post("python-constraints", "2026-01-01T00:00:00Z"),
			post("htmx-comments", "2026-01-06T00:00:00Z"),
			post("red-screens", "2026-01-03T00:00:00Z", "2023-05-01T00:00:00Z"),
			post(
				"mozilla-observatory",
				"2026-01-03T00:00:00Z",
				"2024-05-01T00:00:00Z",
			),
			post("agent-rules", "2026-01-05T00:00:00Z"),
			post("astro-debugging", "2026-01-02T00:00:00Z"),
			...Array.from({ length: 15 }, (_, index) =>
				post(
					`older-${index + 1}`,
					`2025-12-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
				),
			),
		];
		const expected = [
			"htmx-comments",
			"agent-rules",
			"mozilla-observatory",
			"red-screens",
			"astro-debugging",
			"python-constraints",
			...Array.from({ length: 14 }, (_, index) => `older-${15 - index}`),
		];
		for (const [build, tag] of [
			[rssFeed, "item"],
			[atomFeed, "entry"],
		] as const) {
			assert.deepEqual(
				[...parse(build(posts, SITE, new Map())).querySelectorAll(tag)].map(
					(item) => item.querySelector("title")?.textContent,
				),
				expected.map((slug) => `About ${slug}`),
			);
		}
	});

	it("An edited Atom entry reports its publication and latest update separately", () => {
		const atom = parse(
			atomFeed(
				[
					post("revised", "2026-10-29T16:45:00Z", "2024-03-01T12:00:00Z"),
					post("unchanged", "2026-10-28T09:00:00Z", "2026-10-28T09:00:00Z"),
				],
				SITE,
				new Map(),
			),
		);
		assert.deepEqual(
			[...atom.querySelectorAll("entry")].map((entry) => ({
				published: entry.querySelector("published")?.textContent,
				updated: entry.querySelector("updated")?.textContent,
			})),
			[
				{
					published: "2024-03-01T12:00:00.000Z",
					updated: "2026-10-29T16:45:00.000Z",
				},
				{
					published: "2026-10-28T09:00:00.000Z",
					updated: "2026-10-28T09:00:00.000Z",
				},
			],
		);
		assert.equal(
			rootChild(atom, "updated")?.textContent,
			"2026-10-29T16:45:00.000Z",
		);
	});

	it("RSS items have publication dates, while channel metadata describes the latest update and feed URL", () => {
		const rss = parse(
			rssFeed(
				[
					post("unchanged", "2026-10-28T09:00:00Z", "2026-10-28T09:00:00Z"),
					post("revised", "2026-10-29T16:45:00Z", "2024-03-01T12:00:00Z"),
				],
				SITE,
				new Map(),
			),
		);
		assert.deepEqual(
			[...rss.querySelectorAll("item")].map(
				(item) => item.querySelector("pubDate")?.textContent,
			),
			["Fri, 01 Mar 2024 12:00:00 GMT", "Wed, 28 Oct 2026 09:00:00 GMT"],
		);
		assert.equal(
			rss.querySelector("channel > lastBuildDate")?.textContent,
			"Thu, 29 Oct 2026 16:45:00 GMT",
		);
		assert.equal(rss.querySelector("channel > language")?.textContent, "en-us");
		const self = rss.getElementsByTagNameNS(
			"http://www.w3.org/2005/Atom",
			"link",
		);
		assert.equal(self.length, 1);
		assert.equal(
			self[0]?.getAttribute("href"),
			"https://preview.example/blog/rss.xml",
		);
		assert.equal(self[0]?.getAttribute("rel"), "self");
		assert.equal(self[0]?.getAttribute("type"), "application/rss+xml");
	});

	it("Empty feeds use a stable epoch timestamp instead of the build clock", () => {
		const rss = parse(rssFeed([], SITE, new Map()));
		const atom = parse(atomFeed([], SITE, new Map()));
		assert.equal(
			rss.querySelector("channel > lastBuildDate")?.textContent,
			"Thu, 01 Jan 1970 00:00:00 GMT",
		);
		assert.equal(
			rootChild(atom, "updated")?.textContent,
			"1970-01-01T00:00:00.000Z",
		);
		assert.equal(rss.querySelectorAll("item").length, 0);
		assert.equal(atom.querySelectorAll("entry").length, 0);
	});

	it("A title, description or author full of markup characters reads back as the same text in both feeds", () => {
		const hostile = post(
			"markup-characters",
			"2026-01-01T00:00:00Z",
			undefined,
			{
				title: HOSTILE,
				description: `${HOSTILE} & more`,
			},
		);
		hostile.data.feedAuthor = `O'Brien & <Co>`;
		const rss = parse(rssFeed([hostile], SITE, new Map()));
		assert.deepEqual(
			["title", "description"].map(
				(tag) => rss.querySelector(`item > ${tag}`)?.textContent,
			),
			[HOSTILE, `${HOSTILE} & more`],
		);
		const atom = parse(atomFeed([hostile], SITE, new Map()));
		assert.deepEqual(
			["title", "summary", "author > name"].map(
				(selector) => atom.querySelector(`entry > ${selector}`)?.textContent,
			),
			[HOSTILE, `${HOSTILE} & more`, `O'Brien & <Co>`],
		);
		assert.equal(atom.querySelector("script"), null);
		assert.equal(rss.querySelector("script"), null);
	});

	it("A url-map post redirect with no destination, or two rows for one post, fails the build", () => {
		const [ported] = ROWS;
		assert.ok(ported);
		assert.throws(
			() => legacyFeedIds([{ ...ported, destination: null }]),
			/url-map\.json post row PST-056 has no destination/u,
		);
		assert.throws(
			() =>
				legacyFeedIds([
					ported,
					{ ...ported, id: "PST-999", source: "/post/How-To-Debug/" },
				]),
			/url-map\.json has two post rows for \/blog\/how-to-debug-an-astro-app\//u,
		);
	});
});
