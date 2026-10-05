import { getCollection } from "astro:content";
import { articleHtml, imageUrl, plainText } from "./html.js";
import { categoryCounts, publishedContent } from "./schemas.js";

const WORDS_PER_MINUTE = 238;
const WHITESPACE = /\s+/u;

export async function blogContent() {
	const [entries, categories] = await Promise.all([
		getCollection("posts"),
		getCollection("categories"),
	]);
	return publishedContent(entries, categories);
}

type BlogContent = Awaited<ReturnType<typeof blogContent>>;

// The categories menu: every category by name, with its published post count.
export async function blogNavigation() {
	const { posts, categories } = await blogContent();
	return categoryCounts(posts, categories);
}

function dateLabel(date: Date) {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

// The post cards PostCards.svelte renders, in the given post order.
export function cards(
	posts: BlogContent["posts"],
	categories: BlogContent["categories"],
) {
	return posts.map(({ data, html }) => ({
		slug: data.slug,
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
		updatedLabel: dateLabel(data.updated),
		category: data.category,
		categoryName:
			categories.find((category) => category.data.slug === data.category)?.data
				.name ?? data.category,
		minutes: Math.max(
			1,
			Math.ceil(plainText(html).split(WHITESPACE).length / WORDS_PER_MINUTE),
		),
	}));
}

export type Card = ReturnType<typeof cards>[number];
