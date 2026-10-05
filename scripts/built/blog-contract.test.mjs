import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { categoryHref, postHref } from "../../src/lib/blog/cards.js";
import { allPosts, exists, publishedPosts, readBuilt } from "./pages.mjs";

// The post pages over the built dist/. The first two tests are ported from
// awesome-blog's astro-contract tests "all published legacy URLs exist…" and
// "related cards render…". The expected URLs come from
// legacy/blogthedata/url-map.json (its post and category redirect rows
// replace awesome-blog's migration receipt), and the published posts from the
// post frontmatter, never from the build under test. The search-index half of
// the first test arrives with the index (B09).
const DIST = "dist";
const SITE = "https://www.jsolly.com";
const URL_MAP = new URL(
	"../../legacy/blogthedata/url-map.json",
	import.meta.url,
);
const MANIFEST = new URL(
	"../../src/generated/route-manifest.js",
	import.meta.url,
);
const LOC = /<loc>(?<url>[^<]+)<\/loc>/gu;
// The share targets on every post, each taking the post URL as ?url=.
const SHARE_HOSTS = ["twitter.com", "www.reddit.com", "www.linkedin.com"];

// The url-map.json redirect rows of `kind`, as { id, origin, path } of their
// destinations.
async function redirects(kind) {
	const { rows } = JSON.parse(await readFile(URL_MAP, "utf8"));
	return rows
		.filter((row) => row.class === kind && row.action === "redirect-301")
		.map((row) => {
			const { origin, pathname } = new URL(row.destination);
			return { id: row.id, origin, path: pathname };
		});
}

function readable(document) {
	const body = document.querySelector(".article-body");
	return Boolean(
		body?.textContent.trim() || body?.querySelector("iframe, img"),
	);
}

// The snapshot holds no drafts, so here the draft side holds only as set
// equality (each post is everywhere exactly when published); the draft-leak
// scenario, a real draft in a temp copy, arrives with B14's content-contract
// test.
it("every published legacy post and category URL is built, and each post is in dist, the archive, the sitemap and the route manifest exactly when published", async () => {
	const posts = await allPosts();
	const published = posts.filter((post) => post.published);
	assert.ok(published.length > 0, "the snapshot publishes posts");
	const [postRows, categoryRows] = await Promise.all([
		redirects("post"),
		redirects("category"),
	]);
	assert.ok(categoryRows.length > 0, "url-map.json has category rows");
	assert.deepEqual(
		[...postRows, ...categoryRows].filter((row) => row.origin !== SITE),
		[],
		`post and category rows redirect onto ${SITE}`,
	);
	assert.deepEqual(
		new Set(postRows.map((row) => row.path)),
		new Set(published.map((post) => postHref(post.slug))),
		"url-map.json post rows redirect to exactly the published posts",
	);
	const unbuilt = await Promise.all(
		categoryRows.map(async ({ path }) =>
			(await exists(join(DIST, path, "index.html"))) ? [] : [path],
		),
	);
	assert.deepEqual(unbuilt.flat(), [], "category destinations are built");
	const sitemap = new Set(
		Array.from(
			(await readFile(join(DIST, "sitemap-0.xml"), "utf8")).matchAll(LOC),
			(match) => new URL(match.groups.url).pathname,
		),
	);
	const archive = new Set(
		await readBuilt("blog/all-posts", (document) =>
			[...document.querySelectorAll(".post-card-link")].map((link) =>
				link.getAttribute("href"),
			),
		),
	);
	const { routes } = await import(MANIFEST.href);
	const manifest = new Set(routes);
	// Each post appears everywhere when published and nowhere as a draft.
	const presence = await Promise.all(
		posts.map(async (post) => {
			const path = postHref(post.slug);
			return {
				path,
				built: await exists(join(DIST, path, "index.html")),
				sitemap: sitemap.has(path),
				archive: archive.has(path),
				manifest: manifest.has(path),
			};
		}),
	);
	assert.deepEqual(
		presence,
		posts.map((post) => ({
			path: postHref(post.slug),
			built: post.published,
			sitemap: post.published,
			archive: post.published,
			manifest: post.published,
		})),
	);
	const unreadable = await Promise.all(
		published.map(async (post) =>
			(await readBuilt(postHref(post.slug), readable))
				? []
				: [postHref(post.slug)],
		),
	);
	assert.deepEqual(unreadable.flat(), [], "posts without readable content");
});

it("related cards render the selected published associations", async () => {
	const published = await publishedPosts();
	const slugs = new Set(published.map((post) => post.slug));
	const expected = published.map((post) => ({
		slug: post.slug,
		related: post.related.filter((slug) => slugs.has(slug)).map(postHref),
	}));
	assert.ok(
		expected.some((post) => post.related.length > 0),
		"at least one post has published related posts",
	);
	const actual = await Promise.all(
		published.map(async (post) => ({
			slug: post.slug,
			related: await readBuilt(postHref(post.slug), (document) =>
				[...document.querySelectorAll(".related-posts a.post-card-link")].map(
					(link) => link.getAttribute("href"),
				),
			),
		})),
	);
	assert.deepEqual(actual, expected, "related cards per post");
});

it("every post page names its jsolly.com URL in its JSON-LD and share links and links its built category", async () => {
	const published = await publishedPosts();
	const pages = await Promise.all(
		published.map((post) =>
			readBuilt(postHref(post.slug), (document) => ({
				slug: post.slug,
				jsonLd: [
					...document.querySelectorAll('script[type="application/ld+json"]'),
				].map((script) => JSON.parse(script.textContent)),
				share: [...document.querySelectorAll(".share-actions a")].map(
					(link) => {
						const target = new URL(link.getAttribute("href"));
						return {
							host: target.host,
							url: target.searchParams.get("url"),
						};
					},
				),
				breadcrumb: [...document.querySelectorAll(".breadcrumbs a")].map(
					(link) => link.getAttribute("href"),
				),
			})),
		),
	);
	assert.deepEqual(
		pages.map(({ slug, jsonLd, share, breadcrumb }) => ({
			slug,
			types: jsonLd.map((data) => data["@type"]),
			mainEntityOfPage: jsonLd.map((data) => data.mainEntityOfPage),
			share,
			breadcrumb,
		})),
		published.map((post) => {
			const url = `${SITE}${postHref(post.slug)}`;
			return {
				slug: post.slug,
				types: ["BlogPosting"],
				mainEntityOfPage: [url],
				share: SHARE_HOSTS.map((host) => ({ host, url })),
				breadcrumb: ["/blog/", categoryHref(post.category)],
			};
		}),
	);
	const categories = [...new Set(published.map((post) => post.category))];
	const unbuilt = await Promise.all(
		categories.map(async (category) =>
			(await exists(join(DIST, categoryHref(category), "index.html")))
				? []
				: [categoryHref(category)],
		),
	);
	assert.deepEqual(unbuilt.flat(), [], "breadcrumb categories are built");
});
