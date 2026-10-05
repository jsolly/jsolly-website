import { WORDS_PER_MINUTE } from "./constants.js";
import { articleHtml, imageUrl, plainText } from "./html.js";
import type { Card, CardPost } from "./types.js";

const WHITESPACE = /\s+/u;

// "January 9, 2023": the calendar date in UTC, so the label never depends on
// the build machine's time zone.
export function dateLabel(date: Date) {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

function sameUtcDay(a: Date, b: Date) {
	return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

// A post's page and a category's page; slugs keep their case.
export function postHref(slug: string) {
	return `/blog/${slug}/`;
}

export function categoryHref(category: string) {
	return `/blog/category/${category}/`;
}

// The post cards PostCards.svelte renders, in the given post order.
export function cards(posts: CardPost[]): Card[] {
	return posts.map(({ data, html, categoryName }) => ({
		slug: data.slug,
		href: postHref(data.slug),
		title: data.title,
		description: data.description,
		excerpt: articleHtml(data.excerpt),
		image: imageUrl(data.image),
		imageAlt: data.imageAlt,
		imageWidth: data.imageWidth,
		imageHeight: data.imageHeight,
		published: data.published.toISOString(),
		updated: data.updated.toISOString(),
		dateLabel: dateLabel(data.published),
		updatedLabel: sameUtcDay(data.published, data.updated)
			? null
			: dateLabel(data.updated),
		categoryHref: categoryHref(data.category),
		categoryName,
		minutes: Math.max(
			1,
			Math.ceil(plainText(html).split(WHITESPACE).length / WORDS_PER_MINUTE),
		),
	}));
}
