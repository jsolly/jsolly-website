import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributionLink, cards } from "./cards.js";
import { postSchema } from "./schemas.js";
import type { CardPost } from "./types.js";

// A US zone, where a UTC morning is still the previous evening: a label
// computed in local time would show the wrong day.
process.env.TZ = "America/New_York";

// The frontmatter of src/content/blog/posts/optimizing-ahrefs-orphan-pages-duplicate-content.md.
const FRONTMATTER = {
	slug: "optimizing-ahrefs-orphan-pages-duplicate-content",
	title: "Ahrefs Website Optimization: Fix Orphan Pages & Duplicate Content",
	category: "web-dev",
	description:
		"Audit your website with Ahrefs to fix orphan pages and duplicate content for better UX, higher SEO, and improved performance.",
	draft: false,
	image:
		"https://d1d7p8ufhgz4ld.cloudfront.net/media/post_metaimgs/SeoOptimization.webp",
	legacyImage: "post_metaimgs/SeoOptimization.webp",
	imageAlt:
		"A laptop with analytics on the screen. A robot hand is on the keyboard.",
	imageAttribution:
		"Stable Diffusion 2.1: A computer screen displaying a website's analytics, with a magnifying glass overlaid on top to symbolize the focus on search engine optimization. In the background, a robot works tirelessly to fix errors and improve the website's ranking.",
	imageWidth: 512,
	imageHeight: 512,
	published: "2023-01-09T06:14:18.161Z",
	updated: "2023-01-09T06:14:18.161Z",
	author: "John Solly",
	feedAuthor: "John_Solly",
	legacyAuthorId: 2,
	excerpt:
		"<p>Audit your website with Ahrefs to fix orphan pages and duplicate content for better UX, higher SEO, and improved performance.</p>",
	legacyId: 115,
	related: [
		"get-a-perfect-score-on-seo-tool-ahrefs",
		"social-media-share-links-open-graph",
	],
};

const SAFE_EXCERPT = "<p>Fix <strong>orphan</strong> pages.</p>";

function post(
	frontmatter: Record<string, unknown> = {},
	html = "<p>Notes from the field.</p>",
): CardPost {
	return {
		data: postSchema.parse({ ...FRONTMATTER, ...frontmatter }),
		html,
		categoryName: "Web Dev",
	};
}

describe("blog post cards", () => {
	it("A reader sees the publish date as its UTC calendar day, with the post's links, image and category name", () => {
		const [card, lateEvening] = cards([
			post(),
			// 23:30 in New York is already the next day in UTC.
			post({
				published: "2023-01-09T23:30:00-05:00",
				updated: "2023-01-09T23:30:00-05:00",
			}),
		]);
		assert.deepEqual(
			{
				href: card.href,
				title: card.title,
				image: card.image,
				imageAlt: card.imageAlt,
				imageWidth: card.imageWidth,
				imageHeight: card.imageHeight,
				published: card.published,
				dateLabel: card.dateLabel,
				categoryHref: card.categoryHref,
				categoryName: card.categoryName,
			},
			{
				href: "/blog/optimizing-ahrefs-orphan-pages-duplicate-content/",
				title:
					"Ahrefs Website Optimization: Fix Orphan Pages & Duplicate Content",
				image:
					"https://d1d7p8ufhgz4ld.cloudfront.net/media/post_metaimgs/SeoOptimization.webp",
				imageAlt:
					"A laptop with analytics on the screen. A robot hand is on the keyboard.",
				imageWidth: 512,
				imageHeight: 512,
				published: "2023-01-09T06:14:18.161Z",
				dateLabel: "January 9, 2023",
				categoryHref: "/blog/category/web-dev/",
				categoryName: "Web Dev",
			},
		);
		assert.equal(lateEvening.published, "2023-01-10T04:30:00.000Z");
		assert.equal(lateEvening.dateLabel, "January 10, 2023");
	});

	it("An update on the publish day (UTC) shows no Updated line; a later one does", () => {
		const [sameDay, sameUtcDay, nextUtcDay, later] = cards([
			post(),
			post({ updated: "2023-01-09T23:59:59Z" }),
			// 22:00 on January 9 in New York, but already January 10 in UTC.
			post({
				published: "2023-01-09T06:14:18Z",
				updated: "2023-01-10T03:00:00Z",
			}),
			post({ updated: "2026-09-07T12:00:00Z" }),
		]);
		assert.equal(sameDay.updatedLabel, null);
		assert.equal(sameUtcDay.updatedLabel, null);
		assert.equal(nextUtcDay.updatedLabel, "January 10, 2023");
		assert.equal(later.updatedLabel, "September 7, 2026");
		assert.equal(later.updated, "2026-09-07T12:00:00.000Z");
	});

	it("The reading time is the body's words at 238 a minute, rounded up, and at least one minute", () => {
		const words = (count: number) =>
			`<p>${Array.from({ length: count }, () => "map").join(" ")}</p>`;
		assert.deepEqual(
			cards([
				post({}, words(238)),
				post({}, words(239)),
				post({}, words(1430)),
				post({}, "<p>Short.</p>"),
			]).map((card) => card.minutes),
			[1, 2, 7, 1],
		);
	});

	it("cards() returns the post's excerpt sanitized, an empty excerpt when it has none, and its description either way", () => {
		const [withExcerpt, unsafeExcerpt, withoutExcerpt] = cards([
			post(),
			post({ excerpt: `${SAFE_EXCERPT}<script>steal()</script>` }),
			post({ excerpt: "" }),
		]);
		assert.equal(withExcerpt.excerpt, FRONTMATTER.excerpt);
		assert.equal(unsafeExcerpt.excerpt, SAFE_EXCERPT);
		assert.equal(withoutExcerpt.excerpt, "");
		assert.deepEqual(
			[withExcerpt, withoutExcerpt].map((card) => card.description),
			[FRONTMATTER.description, FRONTMATTER.description],
		);
	});
});

describe("attributionLink", () => {
	it("shortens a URL attribution to a link labelled with its host", () => {
		assert.deepEqual(
			attributionLink(
				"https://www.planetarycomputer.microsoft.com/api/data/v1/item/preview.png?collection=landsat-8-c2-l2",
			),
			{
				href: "https://www.planetarycomputer.microsoft.com/api/data/v1/item/preview.png?collection=landsat-8-c2-l2",
				label: "planetarycomputer.microsoft.com",
			},
		);
	});

	it("leaves a plain-text credit alone", () => {
		assert.equal(attributionLink("Dalle3"), null);
	});

	it("never links a non-web scheme", () => {
		assert.equal(attributionLink("javascript:alert(1)"), null);
		assert.equal(attributionLink("data:text/plain,hello"), null);
	});
});
