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
	category: string;
	categoryName: string;
	minutes: number;
}
