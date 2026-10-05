import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { feed } from "./feeds.js";
import type { FeedPost } from "./types.js";

// A host other than jsolly.com, so a hard-coded one would show.
const SITE = new URL("https://preview.example");
// A ported post: legacy/blogthedata/url-map.json has its post row.
const PORTED = "how-to-debug-an-astro-app";
// A post written after the merge: no url-map.json row.
const NEW = "written-on-jsolly";
const TITLE = `A < B & "C" 'D'`;

function post(slug: string, updated: string, title = slug): FeedPost {
	return {
		data: {
			slug,
			title,
			description: `About ${title}`,
			feedAuthor: "John_Solly",
			published: new Date("2020-01-01T00:00:00Z"),
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

// The direct children of the feed root named `tag`.
function rootChild(document: Document, tag: string) {
	return [...document.documentElement.children].find(
		(child) => child.tagName === tag,
	);
}

describe("feed", () => {
	it("keeps a ported post's blogthedata ids and gives a new post ids on the site", () => {
		const posts = [
			post(NEW, "2026-01-02T00:00:00Z"),
			post(PORTED, "2026-01-01T00:00:00Z"),
		];
		const rss = parse(feed("rss", posts, SITE));
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
					link: `https://preview.example/blog/${NEW}/`,
					guid: `https://preview.example/blog/${NEW}/`,
					isPermaLink: "true",
				},
				{
					link: `https://preview.example/blog/${PORTED}/`,
					guid: `https://www.blogthedata.com/post/${PORTED}/`,
					isPermaLink: "false",
				},
			],
		);
		assert.equal(
			rss.querySelector("channel > link")?.textContent,
			"https://preview.example/blog/rss.xml",
		);

		const atom = parse(feed("atom", posts, SITE));
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
					link: `https://preview.example/blog/${NEW}/`,
					id: `https://preview.example/blog/${NEW}/`,
				},
				{
					link: `https://preview.example/blog/${PORTED}/`,
					id: `https://www.blogthedata.com/post/${PORTED}/`,
				},
			],
		);
	});

	it("lists the five most recently updated posts and escapes their text", () => {
		const escaped = post("p1", "2026-01-01T00:00:00Z", TITLE);
		const posts = [
			escaped,
			post("p2", "2026-01-06T00:00:00Z"),
			post("p3", "2026-01-03T00:00:00Z"),
			post("p4", "2026-01-05T00:00:00Z"),
			post("p5", "2026-01-04T00:00:00Z"),
			post("p6", "2026-01-02T00:00:00Z"),
		];
		for (const [kind, tag] of [
			["rss", "item"],
			["atom", "entry"],
		] as const) {
			assert.deepEqual(
				[...parse(feed(kind, posts, SITE)).querySelectorAll(tag)].map(
					(item) => item.querySelector("title")?.textContent,
				),
				["p2", "p4", "p5", "p3", "p6"],
			);
		}
		const rss = feed("rss", [escaped], SITE);
		assert.ok(
			rss.includes(
				"<title>A &lt; B &amp; &quot;C&quot; &apos;D&apos;</title><link>",
			),
		);
		assert.equal(
			parse(rss).querySelector("item > description")?.textContent,
			`About ${TITLE}`,
		);
	});
});
