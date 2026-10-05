import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { JSDOM } from "jsdom";
import { publishedPosts, readBuilt } from "./pages.mjs";

// The RSS and Atom feeds over the built dist/. The first test is ported from
// awesome-blog's astro-contract test "feeds follow current published metadata
// and retain canonical identities", re-pathed to /blog/{rss,atom}.xml with
// links on jsolly.com; the second is plan §4.7 (decision J8). Expectations
// come from the post frontmatter, url-map.json and vercel.json, never from the
// feed code under test.
const DIST = "dist";
const SITE = "https://www.jsolly.com";
const LEGACY = "https://www.blogthedata.com";
const URL_MAP = new URL(
	"../../legacy/blogthedata/url-map.json",
	import.meta.url,
);
const VERCEL = new URL("../../vercel.json", import.meta.url);
const FEED_SIZE = 5;
// The recipe post moved to /recipes/ (J7); it is no blog post and no feed item.
const RECIPE_POST = "15-minute-dump-and-go-instant-pot-recipes";
const FEEDS = [
	{ kind: "rss", type: "application/rss+xml" },
	{ kind: "atom", type: "application/atom+xml" },
];

// The built feed of `kind` as { raw, document }, parsed as XML (as HTML,
// <link> would be a void element and lose its text).
async function readFeed(kind) {
	const raw = await readFile(join(DIST, "blog", `${kind}.xml`), "utf8");
	const { document } = new JSDOM(raw, { contentType: "application/xml" })
		.window;
	if (document.querySelector("parsererror")) {
		throw new Error(`dist/blog/${kind}.xml is not well-formed XML`);
	}
	return { raw, document };
}

// The direct child of the feed root named `tag`.
function rootChild(document, tag) {
	return [...document.documentElement.children].find(
		(child) => child.tagName === tag,
	);
}

// The published posts the feeds list: most recently updated first, then
// newest published, five of them.
async function feedPosts() {
	return (await publishedPosts())
		.toSorted(
			(a, b) =>
				b.updatedAt.getTime() - a.updatedAt.getTime() ||
				b.publishedAt.getTime() - a.publishedAt.getTime(),
		)
		.slice(0, FEED_SIZE);
}

it("feeds follow current published metadata and retain canonical identities", async () => {
	const posts = await feedPosts();
	assert.equal(posts.length, FEED_SIZE);
	const rss = (await readFeed("rss")).document;
	const atom = (await readFeed("atom")).document;

	assert.deepEqual(
		[...rss.querySelectorAll("item")].map((item) => ({
			title: item.querySelector("title")?.textContent,
			link: item.querySelector("link")?.textContent,
			guid: item.querySelector("guid")?.textContent,
			description: item.querySelector("description")?.textContent,
		})),
		posts.map((post) => ({
			title: post.title,
			link: `${SITE}/blog/${post.slug}/`,
			guid: `${LEGACY}/post/${post.slug}/`,
			description: post.description,
		})),
	);
	assert.equal(
		rss.querySelector("channel > link")?.textContent,
		`${SITE}/blog/rss.xml`,
	);

	assert.deepEqual(
		[...atom.querySelectorAll("entry")].map((entry) => ({
			title: entry.querySelector("title")?.textContent,
			link: entry.querySelector("link")?.getAttribute("href"),
			id: entry.querySelector("id")?.textContent,
			updated: entry.querySelector("updated")?.textContent,
			author: entry.querySelector("author name")?.textContent,
		})),
		posts.map((post) => ({
			title: post.title,
			link: `${SITE}/blog/${post.slug}/`,
			id: `${LEGACY}/post/${post.slug}/`,
			updated: post.publishedAt.toISOString(),
			author: post.feedAuthor,
		})),
	);
	assert.equal(
		rootChild(atom, "link")?.getAttribute("href"),
		`${SITE}/blog/atom.xml`,
	);
	assert.equal(
		rootChild(atom, "updated")?.textContent,
		posts[0].updatedAt.toISOString(),
	);

	// Every blog page advertises both feeds, which the build emits.
	const alternates = await readBuilt("blog", (document) =>
		[...document.querySelectorAll('head link[rel="alternate"]')].map(
			(link) => ({
				type: link.getAttribute("type"),
				href: link.getAttribute("href"),
			}),
		),
	);
	assert.deepEqual(
		alternates,
		FEEDS.map(({ kind, type }) => ({ type, href: `/blog/${kind}.xml` })),
	);
});

it("pre-merge posts keep their blogthedata feed ids, the recipe post is absent, and Vercel sends the feed types", async () => {
	const { rows } = JSON.parse(await readFile(URL_MAP, "utf8"));
	// Pre-merge posts: those with a url-map.json post row (feeds.ts's rule).
	const legacy = new Set(
		rows
			.filter((row) => row.class === "post" && row.action === "redirect-301")
			.map((row) => row.source),
	);
	const posts = await feedPosts();
	for (const post of posts) {
		assert.ok(
			legacy.has(`/post/${post.slug}/`),
			`${post.slug} predates the merge, so this test reaches the legacy-id rule`,
		);
	}

	const rss = await readFeed("rss");
	assert.deepEqual(
		[...rss.document.querySelectorAll("item")].map((item) => {
			const guid = item.querySelector("guid");
			return {
				link: item.querySelector("link")?.textContent,
				guid: guid?.textContent,
				attributes: guid?.getAttributeNames(),
				isPermaLink: guid?.getAttribute("isPermaLink"),
			};
		}),
		posts.map((post) => ({
			link: `https://www.jsolly.com/blog/${post.slug}/`,
			guid: `https://www.blogthedata.com/post/${post.slug}/`,
			attributes: ["isPermaLink"],
			isPermaLink: "false",
		})),
	);

	const atom = await readFeed("atom");
	assert.equal(
		rootChild(atom.document, "id")?.textContent,
		"https://www.blogthedata.com/atom/",
		"the Atom feed id is unchanged",
	);
	assert.deepEqual(
		[...atom.document.querySelectorAll("entry")].map((entry) => ({
			link: entry.querySelector("link")?.getAttribute("href"),
			id: entry.querySelector("id")?.textContent,
		})),
		posts.map((post) => ({
			link: `https://www.jsolly.com/blog/${post.slug}/`,
			id: `https://www.blogthedata.com/post/${post.slug}/`,
		})),
	);

	for (const { raw } of [rss, atom]) {
		assert.ok(!raw.includes(RECIPE_POST), "the recipe post is no feed item");
	}

	const { headers } = JSON.parse(await readFile(VERCEL, "utf8"));
	for (const { kind, type } of FEEDS) {
		assert.deepEqual(
			headers.filter((rule) => rule.source === `/blog/${kind}.xml`),
			[
				{
					source: `/blog/${kind}.xml`,
					headers: [{ key: "Content-Type", value: `${type}; charset=utf-8` }],
				},
			],
		);
	}
});
