import type { z } from "zod";
import type { postSchema } from "./schemas.js";

// A published post as cards() reads it: the frontmatter fields a card shows,
// its rendered html (for the reading time) and its category's name.
export interface CardPost {
	html: string;
	categoryName: string;
	data: Pick<
		z.infer<typeof postSchema>,
		| "slug"
		| "title"
		| "description"
		| "excerpt"
		| "image"
		| "imageAlt"
		| "imageWidth"
		| "imageHeight"
		| "published"
		| "updated"
		| "category"
	>;
}

// One post card as PostCards.svelte renders it. Timestamps are ISO strings
// for <time datetime>; updatedLabel is null when the post was updated on the
// day (UTC) it was published.
export interface Card {
	slug: string;
	href: string;
	title: string;
	description: string;
	excerpt: string;
	image: string;
	imageAlt: string;
	imageWidth: number | null;
	imageHeight: number | null;
	published: string;
	updated: string;
	dateLabel: string;
	updatedLabel: string | null;
	categoryHref: string;
	categoryName: string;
	minutes: number;
}

// A published post as the feeds read it.
export interface FeedPost {
	data: Pick<
		z.infer<typeof postSchema>,
		"slug" | "title" | "description" | "feedAuthor" | "published" | "updated"
	>;
}

// The url-map.json row fields the feeds read to find pre-merge posts.
export interface LegacyRow {
	id: string;
	class: string;
	action: string;
	source: string;
	destination: string | null;
}
