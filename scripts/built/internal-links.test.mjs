import assert from "node:assert/strict";
import { extname } from "node:path";
import it from "node:test";
import { categorySlugs, DIST, publishedPosts } from "./pages.mjs";
import {
	brokenReferences,
	buildSite,
	legacyHostLinks,
	legacyRoots,
	miscasedLinks,
	mixedCaseRoutes,
	POST_TEXT_FIELD,
	readSite,
	SEARCH_INDEX,
	sourceValues,
} from "./site-links.mjs";

// Plan §4.3: the link checks over the whole build. dist/ is read and parsed
// once into a site model (site-links.mjs readSite) that all four tests share;
// each test first runs its checker on a small in-memory site, so a checker
// that stops finding problems fails too.
//   (a) every same-origin reference in the HTML resolves, and every #fragment
//       names an id on its target page;
//   (b) nothing links to the old blog host (url-map.json meta.hosts); bare
//       text is fine, and the feeds' legacy ids are ids, not links;
//   (c) every link to a mixed-case post or category slug uses its exact case;
//   (d) no legacy root path (/post/, /search/, /media/, ...) is built in code
//       or in the JS, JSON and XML the HTML check cannot see.
const MIXED_CASE_POSTS = 22;
const MIXED_CASE_CATEGORIES = ["Geodev"];

let distSite;
// dist/ as a site model, read once for all four tests.
function dist() {
	distSite ??= readSite(DIST).then((site) => {
		if (!site.files.has("index.html")) {
			throw new Error("dist/ is required: run `npm run build` first");
		}
		return site;
	});
	return distSite;
}

// An in-memory site for the checkers' own fixtures.
function fixtureSite(files) {
	return buildSite(
		Object.entries(files).map(([file, text]) => ({ file, text })),
	);
}

const html = (body, head = "") =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

it("(a) every same-origin link, image, script, manifest and icon in the build resolves, and every #fragment names an id on its page", async (t) => {
	const fixture = fixtureSite({
		"index.html": html(
			[
				'<a href="/blog/post/#kept">ok</a>',
				'<a href="/blog/post/#lost">lost id</a>',
				// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
				'<a href="/blog/post/#%E0%A4%A">bad escape</a>',
				'<a href="/blog/post">no slash</a>',
				'<a href="/blog/gone/">gone</a>',
				'<a href="https://www.jsolly.com/blog/Post/">wrong case</a>',
				'<a href="https://example.com/x/">external</a>',
				'<a href="mailto:a@example.com">mail</a>',
				'<a href="#top-id">self</a>',
				'<a href="/index.md">markdown</a>',
				'<img src="/a.webp" srcset="/a.webp 1x, /b.webp 2x">',
				'<p id="top-id"></p>',
			].join(""),
			'<link rel="manifest" href="/site.webmanifest">',
		),
		"blog/post/index.html": html('<h2 id="kept">Kept</h2><a name="named"></a>'),
		"site.webmanifest": JSON.stringify({
			start_url: "/",
			icons: [{ src: "/icon.png" }, { src: "/missing.png" }],
		}),
		"a.webp": null,
		"icon.png": null,
	});
	assert.deepEqual(
		brokenReferences(fixture),
		[
			'index.html href=/blog/post/#lost: has no id "lost" on blog/post/index.html',
			"index.html href=/blog/post/#%E0%A4%A: has a malformed percent escape in the fragment",
			"index.html href=/blog/post: links a page without its trailing slash",
			"index.html href=/blog/gone/: has no file in dist/",
			"index.html href=https://www.jsolly.com/blog/Post/: has no file in dist/",
			"index.html srcset=/b.webp: has no file in dist/",
			"site.webmanifest manifest=/missing.png: has no file in dist/",
		],
		"the checker finds each broken reference in a fixture site",
	);
	const site = await dist();
	const count =
		[...site.pages.values()].reduce(
			(sum, page) => sum + page.references.length,
			0,
		) +
		[...site.manifests.values()].reduce((sum, list) => sum + list.length, 0);
	t.diagnostic(
		`${count} references on ${site.pages.size} pages and ${site.manifests.size} manifests`,
	);
	assert.deepEqual(brokenReferences(site), [], "broken same-origin references");
});

it("(b) the build links nothing on the old blog host; prose may name it and the feeds keep their legacy ids", async () => {
	const fixture = fixtureSite({
		"index.html": html(
			[
				'<a href="https://www.blogthedata.com/post/x/">link</a>',
				'<img src="//blogthedata.vercel.app/a.png">',
				'<a href="https://github.com/jsolly/blogthedata/pull/39">repo</a>',
				'<a href="https://speedvitals.com/ttfb-test?url=https://blogthedata.com">speed test</a>',
				'<div data-href="https://blogthedata.com/x/"></div>',
				'<a href="/blog/How-Ive-made-blogthedata-more-accessible/">slug</a>',
				"<p>Prose: blogthedata.com and https://blogthedata.com/admin as text.</p>",
				'<img src="/shot.png" alt="Google showing https://blogthedata.com/sitemap.xml">',
				// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
				'<script type="application/ld+json">{"sameAs":["https://blogthedata.com"]}</script>',
			].join(""),
		),
		"blog/rss.xml": [
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<?xml version="1.0"?><rss><channel><link>https://www.jsolly.com/blog/rss.xml</link>',
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<item><link>https://www.jsolly.com/blog/x/</link><guid isPermaLink="false">https://www.blogthedata.com/post/x/</guid></item>',
			"<item><link>https://www.blogthedata.com/post/y/</link><guid>https://www.blogthedata.com/post/y/</guid></item>",
			"</channel></rss>",
		].join(""),
		"blog/atom.xml": [
			'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://www.blogthedata.com/atom/</id>',
			'<link href="https://www.blogthedata.com/atom/" rel="self"/>',
			"<entry><id>https://www.blogthedata.com/post/x/</id></entry></feed>",
		].join(""),
		[SEARCH_INDEX]: JSON.stringify([
			{ slug: "x", [POST_TEXT_FIELD]: "visit https://blogthedata.com/admin" },
			{ slug: "y", title: "https://www.blogthedata.com/post/y/" },
		]),
		"app.js": 'fetch("https://blogthedata.com/search-index.json")',
	});
	assert.deepEqual(
		legacyHostLinks(fixture),
		[
			"index.html href=https://www.blogthedata.com/post/x/",
			"index.html src=//blogthedata.vercel.app/a.png",
			"index.html div[data-href]: https://blogthedata.com/x/",
			'index.html script: {"sameAs":["https://blogthedata.com"]}',
			"blog/rss.xml link: https://www.blogthedata.com/post/y/",
			"blog/rss.xml guid: https://www.blogthedata.com/post/y/",
			"blog/atom.xml link[href]: https://www.blogthedata.com/atom/",
			"blog/search-index.json title: https://www.blogthedata.com/post/y/",
			'app.js fetch("https://blogthedata.com/search-index.json")',
		],
		"the checker finds each link to the old host in a fixture site",
	);
	assert.deepEqual(
		legacyHostLinks(await dist()),
		[],
		"links to the old blog host",
	);
});

it("(c) every link to a mixed-case post or category uses the slug's exact case", async (t) => {
	const fixture = fixtureSite({
		"index.html": html(
			[
				'<a href="/blog/Mixed-Post/">exact</a>',
				'<a href="/blog/mixed-post/">lower</a>',
				'<a href="https://www.jsolly.com/blog/category/geodev/">lower category</a>',
				'<a href="/blog/mixed-post-two/">another slug</a>',
			].join(""),
		),
		"sitemap-0.xml": "<loc>https://www.jsolly.com/blog/MIXED-POST/</loc>",
	});
	assert.deepEqual(
		miscasedLinks(fixture, mixedCaseRoutes(["Mixed-Post"], ["Geodev"])),
		[
			"index.html: /blog/mixed-post (route /blog/Mixed-Post)",
			"index.html: /blog/category/geodev (route /blog/category/Geodev)",
			"sitemap-0.xml: /blog/MIXED-POST (route /blog/Mixed-Post)",
		],
		"the checker finds each miscased link in a fixture site",
	);
	const posts = (await publishedPosts())
		.map((post) => post.slug)
		.filter((slug) => slug !== slug.toLowerCase());
	const categories = (await categorySlugs()).filter(
		(slug) => slug !== slug.toLowerCase(),
	);
	t.diagnostic(
		`${posts.length} mixed-case posts and ${categories.length} mixed-case categories (${categories.join(", ")})`,
	);
	assert.equal(
		posts.length,
		MIXED_CASE_POSTS,
		"plan §4.3 (c) freezes the migration contract at 22 mixed-case posts; a changed count means the content changed, not that a link is wrong",
	);
	assert.deepEqual(
		categories,
		MIXED_CASE_CATEGORIES,
		"plan §4.3 (c) freezes the migration contract at one mixed-case category, Geodev; a change means the content changed, not that a link is wrong",
	);
	const routes = mixedCaseRoutes(posts, categories);
	assert.equal(
		routes.size,
		posts.length + categories.length,
		"no two routes differ only in case",
	);
	assert.deepEqual(
		miscasedLinks(await dist(), routes),
		[],
		"links in the wrong case",
	);
});

it("(d) no legacy root path is built in src/ code or in the build's JS, JSON, XML and manifests", async () => {
	const flagged = [
		'"/post/x/"',
		"'/category/Geodev/'",
		"(/media/a.png)",
		"href=/rss/",
		"see /atom/ here",
		"`/search-index.json`",
		"`/search/?searched=x`",
		'"/data/x.json"',
		'"/recipes-pwa/icon.png"',
		'"/social/x.svg"',
		'"/all-posts/"',
		"https://www.blogthedata.com/post/x/",
		"https://blogthedata.com/atom/",
		"https://www.jsolly.com/search.json",
	];
	const passed = [
		'"/blog/post-x/"',
		'"/blog/media/x.webp"',
		'"/blog/category/Geodev/"',
		'"/blog/search/"',
		'"/blog/search-index.json"',
		'"/recipes/data/recipe-library.json"',
		'"/recipes/pwa/icon-192.png"',
		'"/blog/social/xLogo.svg"',
		"https://example.com/post/x/",
		"https://d1d7p8ufhgz4ld.cloudfront.net/media/post_metaimgs/a.png",
		'"/posts/"',
		'"/media"',
	];
	assert.deepEqual(
		flagged.filter((value) => legacyRoots("fixture", [value]).length !== 1),
		[],
		"each legacy root form is caught once",
	);
	assert.deepEqual(
		passed.flatMap((value) => legacyRoots("fixture", [value])),
		[],
		"new paths and external URLs are not legacy roots",
	);
	const fixture = fixtureSite({
		"blog/rss.xml": [
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<?xml version="1.0"?><rss><channel>',
			// biome-ignore lint/security/noSecrets: fixture markup, not credential material.
			'<item><guid isPermaLink="false">https://www.blogthedata.com/post/x/</guid></item>',
			"<item><link>https://www.jsolly.com/post/y/</link></item></channel></rss>",
		].join(""),
		[SEARCH_INDEX]: JSON.stringify([
			{ slug: "x", [POST_TEXT_FIELD]: "the code read /media/uploads" },
			{ slug: "/post/y/", title: "y" },
		]),
	});
	assert.deepEqual(
		[...fixture.values].flatMap(([file, values]) => legacyRoots(file, values)),
		[
			"blog/rss.xml: link: https://www.jsolly.com/post/y/",
			"blog/search-index.json: slug: /post/y/",
		],
		"the allowlist covers only the feed ids and the search index's post text",
	);
	const site = await dist();
	const built = [...site.values]
		.filter(([file]) =>
			[".js", ".json", ".xml", ".webmanifest"].includes(extname(file)),
		)
		.flatMap(([file, values]) => legacyRoots(file, values));
	const source = (await sourceValues()).flatMap(([file, values]) =>
		legacyRoots(file, values),
	);
	assert.deepEqual([...source, ...built], [], "legacy root paths");
});
