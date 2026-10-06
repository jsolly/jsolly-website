import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { JSDOM } from "jsdom";
import { allPosts, publishedPosts, readBuilt } from "./pages.mjs";

// The RSS and Atom feeds over the built dist/. The first test is ported from
// awesome-blog's astro-contract test "feeds follow current published metadata
// and retain canonical identities", re-pathed to /blog/{rss,atom}.xml with
// links on jsolly.com; the second is plan §4.7 (decision J8), whose
// Content-Type half is scripts/unit/vercel-feed-headers.test.mjs. Expectations
// come from the post frontmatter and url-map.json, never from the feed code
// under test.
const DIST = "dist";
const SITE = "https://www.jsolly.com";
const LEGACY = "https://www.blogthedata.com";
const URL_MAP = new URL(
	"../../legacy/blogthedata/url-map.json",
	import.meta.url,
);
const FEED_SIZE = 5;
// The recipe post moved to /recipes/ (J7); it is no blog post, so no feed item.
const RECIPE_POST = "15-minute-dump-and-go-instant-pot-recipes";
const FEEDS = [
	{ kind: "rss", type: "application/rss+xml" },
	{ kind: "atom", type: "application/atom+xml" },
];

// The built feed of `kind` as a document, parsed as XML (as HTML,
// <link> would be a void element and lose its text).
async function readFeed(kind) {
	const raw = await readFile(join(DIST, "blog", `${kind}.xml`), "utf8");
	const { document } = new JSDOM(raw, { contentType: "application/xml" })
		.window;
	if (document.querySelector("parsererror")) {
		throw new Error(`dist/blog/${kind}.xml is not well-formed XML`);
	}
	return document;
}

// The direct child of the feed root named `tag`.
function rootChild(document, tag) {
	return [...document.documentElement.children].find(
		(child) => child.tagName === tag,
	);
}

// Each feed post's expected ids. A post with a url-map.json post redirect row
// predates the merge and keeps that row's blogthedata.com URL (J8); any other
// post was written on jsolly.com and its link is its id.
async function expectedIds(posts) {
	const { rows } = JSON.parse(await readFile(URL_MAP, "utf8"));
	const legacy = new Map(
		rows
			.filter((row) => row.class === "post" && row.action === "redirect-301")
			.map((row) => [
				new URL(row.destination).pathname,
				`${LEGACY}${row.source}`,
			]),
	);
	return posts.map((post) => {
		const link = `${SITE}/blog/${post.slug}/`;
		const legacyId = legacy.get(`/blog/${post.slug}/`);
		return { link, id: legacyId ?? link, legacy: legacyId !== undefined };
	});
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
	const ids = await expectedIds(posts);
	const rss = await readFeed("rss");
	const atom = await readFeed("atom");

	assert.deepEqual(
		[...rss.querySelectorAll("item")].map((item) => ({
			title: item.querySelector("title")?.textContent,
			link: item.querySelector("link")?.textContent,
			guid: item.querySelector("guid")?.textContent,
			description: item.querySelector("description")?.textContent,
		})),
		posts.map((post, index) => ({
			title: post.title,
			link: ids[index].link,
			guid: ids[index].id,
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
		posts.map((post, index) => ({
			title: post.title,
			link: ids[index].link,
			id: ids[index].id,
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

it("pre-merge posts keep their blogthedata feed ids exactly, new posts get jsolly ids, and the recipe post is no blog post", async () => {
	const posts = await feedPosts();
	const ids = await expectedIds(posts);
	assert.ok(
		ids.some((id) => id.legacy),
		"at least one feed item predates the merge, so the legacy-id rule is reached",
	);

	const rss = await readFeed("rss");
	assert.deepEqual(
		[...rss.querySelectorAll("item")].map((item) => {
			const guid = item.querySelector("guid");
			return {
				link: item.querySelector("link")?.textContent,
				guid: guid?.textContent,
				attributes: guid?.getAttributeNames(),
				isPermaLink: guid?.getAttribute("isPermaLink"),
			};
		}),
		ids.map(({ link, id, legacy }) => ({
			link,
			guid: id,
			attributes: ["isPermaLink"],
			isPermaLink: legacy ? "false" : "true",
		})),
	);

	const atom = await readFeed("atom");
	assert.equal(
		rootChild(atom, "id")?.textContent,
		"https://www.blogthedata.com/atom/",
		"the Atom feed id is unchanged",
	);
	assert.deepEqual(
		[...atom.querySelectorAll("entry")].map((entry) => ({
			link: entry.querySelector("link")?.getAttribute("href"),
			id: entry.querySelector("id")?.textContent,
		})),
		ids.map(({ link, id }) => ({ link, id })),
	);

	assert.ok(
		!(await allPosts()).some((post) => post.slug === RECIPE_POST),
		"the recipe post is not in the posts collection, so no feed lists it",
	);
});
