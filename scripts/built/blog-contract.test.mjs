import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { JSDOM } from "jsdom";
import { allPosts, exists } from "./pages.mjs";

// The post pages over the built dist/, ported from awesome-blog's
// astro-contract tests "all published legacy URLs exist…" and "related cards
// render…". The expected URLs come from legacy/blogthedata/url-map.json (its
// post and category redirect rows replace awesome-blog's migration receipt),
// and the published and draft posts from the post frontmatter, never from the
// build under test. The search-index half of the first test arrives with the
// index (B09).
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

const postPath = (slug) => `/blog/${slug}/`;

// Reads a built page with `read(document)`, closing the DOM afterwards.
async function readBuilt(path, read) {
	const dom = new JSDOM(await readFile(join(DIST, path, "index.html"), "utf8"));
	try {
		return read(dom.window.document);
	} finally {
		dom.window.close();
	}
}

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

it("every published legacy post and category URL is built, and no draft reaches dist, the archive, the sitemap or the route manifest", async () => {
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
		new Set(published.map((post) => postPath(post.slug))),
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
			const path = postPath(post.slug);
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
			path: postPath(post.slug),
			built: post.published,
			sitemap: post.published,
			archive: post.published,
			manifest: post.published,
		})),
	);
	const unreadable = await Promise.all(
		published.map(async (post) =>
			(await readBuilt(postPath(post.slug), readable))
				? []
				: [postPath(post.slug)],
		),
	);
	assert.deepEqual(unreadable.flat(), [], "posts without readable content");
});

it("related cards render the selected published associations", async () => {
	const posts = await allPosts();
	const published = posts.filter((post) => post.published);
	const slugs = new Set(published.map((post) => post.slug));
	const expected = published.map((post) => ({
		slug: post.slug,
		related: post.related.filter((slug) => slugs.has(slug)).map(postPath),
	}));
	assert.ok(
		expected.some((post) => post.related.length > 0),
		"at least one post has published related posts",
	);
	const actual = await Promise.all(
		published.map(async (post) => ({
			slug: post.slug,
			related: await readBuilt(postPath(post.slug), (document) =>
				[...document.querySelectorAll(".related-posts a.post-card-link")].map(
					(link) => link.getAttribute("href"),
				),
			),
		})),
	);
	assert.deepEqual(actual, expected, "related cards per post");
});
