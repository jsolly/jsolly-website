import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll as before, it } from "vitest";
import middleware from "../../middleware.js";
import retiredCategories from "../../src/lib/blog/retired-categories.json" with {
	type: "json",
};
import { categoryHref, postHref } from "../../src/lib/blog/urls.js";
import {
	allPosts,
	categorySlugs,
	exists,
	publishedPosts,
	readBuilt,
	routeManifest,
} from "./pages.mjs";

// The post pages over the built dist/. The first two tests are ported from
// awesome-blog's astro-contract tests "all published legacy URLs exist…" and
// "related cards render…". The expected URLs come from
// legacy/blogthedata/url-map.json (its post and category redirect rows
// replace awesome-blog's migration receipt), and the published posts from the
// post frontmatter, never from the build under test.
const DIST = "dist";
const SITE = "https://www.jsolly.com";
const URL_MAP = new URL(
	"../../legacy/blogthedata/url-map.json",
	import.meta.url,
);
const LOC = /<loc>(?<url>[^<]+)<\/loc>/gu;
// The share targets on every post, in order, each taking the post URL as
// ?url=.
const SHARE_TARGETS = [
	{ host: "twitter.com", pathname: "/intent/tweet/" },
	{ host: "www.reddit.com", pathname: "/submit" },
	{ host: "www.linkedin.com", pathname: "/sharing/share-offsite/" },
];

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

// A post page's article: whether it has text, and whether it embeds a frame
// or an image (an article may be only that).
function article(document) {
	const body = document.querySelector(".article-body");
	return {
		text: Boolean(body?.textContent.trim()),
		media: Boolean(body?.querySelector("iframe, img")),
	};
}

// All three contracts inspect the same immutable built post pages. Read each
// document once and retain only the facts; readBuilt closes every DOM window.
let postPages;
before(async () => {
	const published = await publishedPosts();
	postPages = await Promise.all(
		published.map((post) =>
			readBuilt(postHref(post.slug), (document) => ({
				slug: post.slug,
				...article(document),
				related: [
					...document.querySelectorAll(".related-posts h3 > a.post-card-link"),
				].map((link) => link.getAttribute("href")),
				jsonLd: [
					...document.querySelectorAll('script[type="application/ld+json"]'),
				].map((script) => JSON.parse(script.textContent)),
				share: [...document.querySelectorAll(".share-actions a")].map(
					(link) => {
						const target = new URL(link.getAttribute("href"));
						return {
							host: target.host,
							pathname: target.pathname,
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
});

// The snapshot holds no drafts, so the draft half of "exactly when published"
// is held by blog-content-contracts.test.mjs, which builds a real draft in a
// temp copy and finds it in no built file (page, archive, search index,
// sitemap, feeds) and not in the route manifest.
it("every legacy post and category URL leads to a built page, and each post is built, archived, searchable, in the sitemap and in the route manifest exactly when published", async () => {
	const descriptions = await Promise.all(
		["blog", "blog/all-posts"].map((path) =>
			readBuilt(path, (document) => ({
				description: document
					// biome-ignore lint/security/noSecrets: a static CSS selector, not a credential.
					.querySelector("meta[name=description]")
					?.getAttribute("content"),
				social: document
					.querySelector('meta[property="og:description"]')
					?.getAttribute("content"),
			})),
		),
	);
	assert.ok(
		descriptions.every(
			({ description, social }) => description && social === description,
		),
		"blog landing and archive expose matching search and social descriptions",
	);
	assert.notEqual(
		descriptions[0].description,
		descriptions[1].description,
		"latest posts and the full archive have distinct descriptions",
	);
	const posts = await allPosts();
	const published = posts.filter((post) => post.published);
	assert.ok(published.length > 0, "the snapshot publishes posts");
	const [postRows, categoryRows] = await Promise.all([
		redirects("post"),
		redirects("category"),
	]);
	assert.deepEqual(
		new Set(categoryRows.map((row) => row.path)),
		new Set([
			...(await categorySlugs()).map(categoryHref),
			...retiredCategories.map(({ slug }) => categoryHref(slug)),
		]),
		"url-map.json category rows redirect to exactly the active categories and retirement notices, slug case kept",
	);
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
	const index = JSON.parse(
		await readFile(join(DIST, "blog/search-index.json"), "utf8"),
	);
	const indexed = new Map(index.map((entry) => [entry.slug, entry]));
	assert.equal(indexed.size, index.length, "one search entry per slug");
	const manifest = new Set(await routeManifest());
	// Each post is in all five exactly when published.
	const presence = await Promise.all(
		posts.map(async (post) => {
			const path = postHref(post.slug);
			return {
				path,
				built: await exists(join(DIST, path, "index.html")),
				sitemap: sitemap.has(path),
				archive: archive.has(path),
				search: indexed.has(post.slug),
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
			search: post.published,
			manifest: post.published,
		})),
	);
	assert.equal(index.length, published.length, "search entries");
	// Readable on its page, and findable by its text unless it is only media.
	const unreadable = published.map((post) => {
		const { text, media } = postPages.find((page) => page.slug === post.slug);
		return (text || media) && (indexed.get(post.slug).text || media)
			? []
			: [postHref(post.slug)];
	});
	assert.deepEqual(
		unreadable.flat(),
		[],
		"posts without readable content on their page or in the search index",
	);
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
	const actual = postPages.map(({ slug, related }) => ({ slug, related }));
	assert.deepEqual(actual, expected, "related cards per post");
});

it("every post page names its jsolly.com URL in its JSON-LD and share links and links its built category", async () => {
	const published = await publishedPosts();
	const pages = postPages;
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
				share: SHARE_TARGETS.map((target) => ({ ...target, url })),
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

it("retired categories keep noindex HTML and Markdown notices outside navigation and the sitemap", async () => {
	const active = new Set(await categorySlugs());
	const sitemap = await readFile(join(DIST, "sitemap-0.xml"), "utf8");
	assert.ok(retiredCategories.length > 0, "retirement coverage has a real URL");
	await Promise.all(
		retiredCategories.map(async ({ slug, name }) => {
			const path = categoryHref(slug);
			assert.ok(
				!active.has(slug),
				`${slug} is outside the active category collection`,
			);
			const facts = await readBuilt(path, (document) => ({
				title: document.querySelector("h1")?.textContent,
				robots: document
					// biome-ignore lint/security/noSecrets: a static CSS selector, not a credential.
					.querySelector('meta[name="robots"]')
					?.getAttribute("content"),
				canonical: document
					// biome-ignore lint/security/noSecrets: a static CSS selector, not a credential.
					.querySelector('link[rel="canonical"]')
					?.getAttribute("href"),
				text: document.querySelector("main").textContent,
				browse: document.querySelector('main a[href="/blog/"]')?.textContent,
				cards: document.querySelectorAll(".post-card").length,
				selfLinks: document.querySelectorAll(`a[href="${path}"]`).length,
			}));
			assert.equal(facts.title, name);
			assert.equal(facts.robots, "noindex, follow");
			assert.equal(facts.canonical, `${SITE}${path}`);
			assert.ok(facts.text.includes("This category is no longer used."));
			assert.equal(facts.browse, "Browse the blog");
			assert.equal(facts.cards, 0);
			assert.equal(facts.selfLinks, 0, "no category navigation link");
			assert.ok(!sitemap.includes(`${SITE}${path}`));
			const markdown = await readFile(
				join(DIST, `blog/category/${slug}.md`),
				"utf8",
			);
			assert.ok(markdown.includes("This category is no longer used."));
			assert.ok(
				markdown.includes("[Browse the blog](https://www.jsolly.com/blog/)"),
			);
			for (const method of ["GET", "HEAD"]) {
				for (const [url, accept] of [
					[path, "text/html"],
					[path, "text/markdown"],
					[`/blog/category/${slug}.md`, "*/*"],
				]) {
					const response = middleware(
						new Request(`${SITE}${url}`, { method, headers: { accept } }),
					);
					assert.equal(
						response.headers.get("x-robots-tag"),
						"noindex",
						`${method} ${url} ${accept}`,
					);
				}
			}
		}),
	);
	const activeResponse = middleware(
		new Request(`${SITE}/blog/category/Geodev/`),
	);
	assert.equal(
		activeResponse.headers.get("x-robots-tag"),
		null,
		"active categories stay indexable",
	);
});
