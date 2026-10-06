import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_FRONTMATTER_KEYS } from "./constants.js";
import {
	categoryCounts,
	categorySchema,
	postSchema,
	publishedContent,
} from "./schemas.js";

// Frontmatter as PagesCMS saves it, plus the unmanaged legacy fields.
const CMS_POST = {
	slug: "Some-Post",
	title: "A post",
	category: "Geodev",
	description: "Description",
	draft: false,
	published: "2026-10-02T14:00:23.123456-04:00",
	updated: "2026-10-02T14:00:23Z",
	legacyId: 42,
	legacyImage: "post_metaimgs/test.webp",
	legacyAuthorId: 2,
};

// The paths a post fails validation at; empty when it passes.
function failingPaths(input: unknown) {
	const result = postSchema.safeParse(input);
	return result.success
		? []
		: result.error.issues.map((issue) => issue.path.join("."));
}

describe("blog collection schemas", () => {
	it("A PagesCMS post carrying unmanaged legacy fields loads with only the managed fields and the default image", () => {
		const post = postSchema.parse(CMS_POST);
		for (const key of LEGACY_FRONTMATTER_KEYS) {
			assert.equal(Object.hasOwn(post, key), false, key);
		}
		assert.equal(post.slug, "Some-Post");
		assert.equal(post.image, "/blog/media/default.webp");
		assert.equal(post.published.toISOString(), "2026-10-02T18:00:23.123Z");
		const category = categorySchema.parse({
			slug: "Geodev",
			name: "Geo Dev",
			description: "Spatial development",
			legacyId: 1,
		});
		assert.equal(Object.hasOwn(category, "legacyId"), false);
		assert.equal(category.name, "Geo Dev");
	});

	it("A CMS edit that drops the timezone offset fails validation", () => {
		assert.deepEqual(
			failingPaths({ ...CMS_POST, published: "2026-10-02T14:00:23" }),
			["published"],
		);
	});

	it("A category slug with a space or slash fails validation", () => {
		assert.deepEqual(failingPaths({ ...CMS_POST, category: "Geo dev" }), [
			"category",
		]);
		const category = categorySchema.safeParse({
			slug: "geo/dev",
			name: "Geo Dev",
			description: "",
		});
		assert.equal(category.success, false);
		assert.deepEqual(
			category.error?.issues.map((issue) => issue.path.join(".")),
			["slug"],
		);
	});

	it("A post saved with an empty title fails validation", () => {
		assert.deepEqual(failingPaths({ ...CMS_POST, title: "" }), ["title"]);
	});
});

// A loaded post entry as getCollection returns it, reduced to what the
// collection-wide checks read.
function entry(
	slug: string,
	category: string,
	published: string,
	overrides: {
		draft?: boolean;
		body?: string;
		html?: string;
		related?: string[];
	} = {},
) {
	return {
		body: overrides.body ?? "Notes from the field.",
		rendered: { html: overrides.html ?? "<p>Notes from the field.</p>" },
		data: {
			slug,
			category,
			draft: overrides.draft ?? false,
			published: new Date(published),
			related: overrides.related ?? [],
		},
	};
}

const CATEGORIES = [
	{ data: { slug: "Web-Development", name: "Web Development" } },
	{ data: { slug: "Geodev", name: "Geodev" } },
	{ data: { slug: "Productivity", name: "Productivity" } },
];

const POSTS = [
	entry("intro-to-stac-apis", "Geodev", "2023-01-15T12:00:00Z"),
	entry("mapbox-vector-tiles", "Geodev", "2024-06-01T12:00:00Z"),
	entry("content-security-policy", "Web-Development", "2025-03-10T12:00:00Z"),
	entry("weekly-review-template", "Productivity", "2026-09-01T12:00:00Z", {
		draft: true,
	}),
];

describe("published blog content", () => {
	it("A reader sees published posts newest first with their category names, never drafts, and categories by name", () => {
		const { posts, categories } = publishedContent(POSTS, CATEGORIES);
		assert.deepEqual(
			posts.map((post) => [post.data.slug, post.html, post.categoryName]),
			[
				[
					"content-security-policy",
					"<p>Notes from the field.</p>",
					"Web Development",
				],
				["mapbox-vector-tiles", "<p>Notes from the field.</p>", "Geodev"],
				["intro-to-stac-apis", "<p>Notes from the field.</p>", "Geodev"],
			],
		);
		assert.deepEqual(
			categories.map((category) => category.data.slug),
			["Geodev", "Productivity", "Web-Development"],
		);
	});

	it("The categories menu counts each category's published posts, in name order", () => {
		const { posts, categories } = publishedContent(POSTS, CATEGORIES);
		const menu = categoryCounts(posts, categories);
		assert.deepEqual(menu, [
			{ slug: "Geodev", name: "Geodev", count: 2 },
			{ slug: "Productivity", name: "Productivity", count: 0 },
			{ slug: "Web-Development", name: "Web Development", count: 1 },
		]);
		assert.equal(
			menu.reduce((sum, { count }) => sum + count, 0),
			POSTS.filter((post) => !post.data.draft).length,
			"the counts cover every published post and no draft",
		);
	});

	it("The build stops on an empty article, a duplicate post or category slug, or an unknown category, naming the offender", () => {
		const cases = [
			{
				entries: [
					entry("untitled-draft", "Geodev", "2026-01-01T00:00:00Z", {
						body: "  ",
					}),
				],
				categories: CATEGORIES,
				message: "Empty article: untitled-draft",
			},
			{
				entries: [
					entry("unrendered-post", "Geodev", "2026-01-01T00:00:00Z", {
						html: "",
					}),
				],
				categories: CATEGORIES,
				message: "Empty article: unrendered-post",
			},
			{
				entries: [
					entry("mapbox-vector-tiles", "Geodev", "2024-06-01T12:00:00Z"),
					entry("mapbox-vector-tiles", "Geodev", "2025-06-01T12:00:00Z"),
				],
				categories: CATEGORIES,
				message: "Duplicate post slug: mapbox-vector-tiles",
			},
			{
				entries: [],
				categories: [...CATEGORIES, CATEGORIES[1]],
				message: "Duplicate category slug: Geodev",
			},
			{
				entries: [entry("bread-starter", "Baking", "2026-01-01T00:00:00Z")],
				categories: CATEGORIES,
				message: "Unknown category: Baking (post bread-starter)",
			},
		];
		for (const { entries, categories, message } of cases) {
			assert.throws(() => publishedContent(entries, categories), {
				message,
			});
		}
	});

	it("A related slug that names no post stops the build, naming it and its post, even when a draft holds it; one that names a draft does not", () => {
		const relating = (related: string[]) => [
			...POSTS,
			entry("stac-browser-tips", "Geodev", "2026-02-01T12:00:00Z", {
				related,
			}),
		];
		assert.throws(
			() =>
				publishedContent(
					relating(["intro-to-stac-apis", "15-minute-instant-pot-recipes"]),
					CATEGORIES,
				),
			{
				message:
					"Unknown related post: 15-minute-instant-pot-recipes (post stac-browser-tips)",
			},
		);
		// The rule covers every loaded post, so a draft cannot be published later
		// with a broken related list.
		assert.throws(
			() =>
				publishedContent(
					[
						...POSTS,
						entry("stac-browser-draft", "Geodev", "2026-02-01T12:00:00Z", {
							draft: true,
							related: ["15-minute-instant-pot-recipes"],
						}),
					],
					CATEGORIES,
				),
			{
				message:
					"Unknown related post: 15-minute-instant-pot-recipes (post stac-browser-draft)",
			},
		);
		const { posts } = publishedContent(
			relating(["intro-to-stac-apis", "weekly-review-template"]),
			CATEGORIES,
		);
		assert.deepEqual(
			posts.map((post) => post.data.slug),
			[
				"stac-browser-tips",
				"content-security-policy",
				"mapbox-vector-tiles",
				"intro-to-stac-apis",
			],
		);
	});
});
