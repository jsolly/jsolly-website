import assert from "node:assert/strict";
import { it } from "vitest";
import { postSchema } from "./schemas.js";
import { blogPosting, breadcrumbList, jsonLd } from "./structured-data.js";

const site = new URL("https://www.jsolly.com/");

it("breadcrumbs preserve the visible labels, order and exact-case URLs", () => {
	assert.deepEqual(
		breadcrumbList(
			[
				{ name: "Home", href: "/" },
				{ name: "Blog", href: "/blog/" },
				{ name: "Geodev", href: "/blog/category/Geodev/" },
			],
			site,
		).itemListElement,
		[
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://www.jsolly.com/",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Blog",
				item: "https://www.jsolly.com/blog/",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: "Geodev",
				item: "https://www.jsolly.com/blog/category/Geodev/",
			},
		],
	);
});

it("post metadata links the site entities and preserves a different author", () => {
	const data = postSchema.parse({
		slug: "Case-Sensitive",
		title: "A post",
		category: "Geodev",
		description: "A summary",
		published: "2025-01-01T00:00:00Z",
		updated: "2026-01-01T00:00:00Z",
		image: "/blog/media/hero.webp",
		imageWidth: 960,
		imageHeight: 720,
	});
	const post = blogPosting(data, "Geospatial development", site);
	assert.deepEqual(post.author, { "@id": "https://www.jsolly.com/#person" });
	assert.deepEqual(post.publisher, {
		"@id": "https://www.jsolly.com/#organization",
	});
	assert.deepEqual(post.mainEntityOfPage, {
		"@type": "WebPage",
		"@id": "https://www.jsolly.com/blog/Case-Sensitive/",
	});
	assert.deepEqual(post.image, {
		"@type": "ImageObject",
		url: "https://www.jsolly.com/blog/media/hero.webp",
		width: 960,
		height: 720,
	});
	assert.equal(post.articleSection, "Geospatial development");
	assert.equal(post.inLanguage, "en-US");
	assert.equal(post.datePublished, "2025-01-01T00:00:00.000Z");
	assert.equal(post.dateModified, "2026-01-01T00:00:00.000Z");
	assert.deepEqual(
		blogPosting(
			{ ...data, author: "Guest writer", imageWidth: null, imageHeight: null },
			"Geodev",
			site,
		).author,
		{ "@type": "Person", name: "Guest writer" },
	);
});

it("JSON-LD script serialization roundtrips authored closing-script text without an HTML closing tag", () => {
	const value = { name: "</script><img src=x onerror=alert(1)>" };
	const serialized = jsonLd(value);
	assert.ok(!serialized.includes("<"));
	assert.deepEqual(JSON.parse(serialized), value);
});
