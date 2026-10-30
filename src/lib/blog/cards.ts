import { WORDS_PER_MINUTE } from "./constants.js";
import { articleHtml, plainText } from "./html.js";
import { imageUrl, responsiveImage } from "./images.js";
import type { Card, CardPost } from "./types.js";
import { categoryHref, postHref } from "./urls.js";

const WHITESPACE = /\s+/u;

const LEADING_WWW = /^www\./u;

// A post's image attribution is free text ("Dalle3") or, on migrated posts,
// the image's own URL. Returns the link and a short host label for the URL
// form, so the page shows "Image source: images.example.com" instead of a
// long address, and null for plain text.
export function attributionLink(attribution: string) {
	if (!URL.canParse(attribution)) return null;
	const url = new URL(attribution);
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	return { href: url.href, label: url.hostname.replace(LEADING_WWW, "") };
}

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

// The post cards PostCards.svelte renders, in the given post order.
export function cards(posts: CardPost[]): Card[] {
	return posts.map(({ data, html, categoryName }) => {
		const responsive = responsiveImage(data.image);
		return {
			slug: data.slug,
			href: postHref(data.slug),
			title: data.title,
			description: data.description,
			excerpt: articleHtml(data.excerpt),
			image: imageUrl(data.image),
			...(responsive ? { imageSrcset: responsive.srcset } : {}),
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
		};
	});
}
