import { z } from "zod";
import { DEFAULT_IMAGE } from "./constants.js";

// Post and category slugs; case is kept. .pages.yml gives both slug fields
// this pattern.
export const SLUG = /^[A-Za-z0-9_-]+$/u;

const slug = z.string().regex(SLUG);
const timestamp = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

// legacyId, legacyImage and legacyAuthorId stay in the frontmatter as
// unmanaged PagesCMS data; the default object schema strips them (J19).
export const postSchema = z.object({
	slug,
	title: z.string().min(1),
	category: slug,
	description: z.string(),
	draft: z.boolean().default(true),
	image: z.string().default(DEFAULT_IMAGE),
	imageAlt: z.string().default(""),
	imageAttribution: z.string().default(""),
	imageWidth: z.number().int().positive().nullable().default(null),
	imageHeight: z.number().int().positive().nullable().default(null),
	published: timestamp,
	updated: timestamp,
	author: z.string().default("John Solly"),
	feedAuthor: z.string().default("John_Solly"),
	excerpt: z.string().default(""),
	related: z.array(slug).default([]),
});

export const categorySchema = z.object({
	slug,
	name: z.string().min(1),
	description: z.string(),
});

// The fields of a loaded entry that the collection-wide checks read.
type PostEntry = {
	body?: string;
	rendered?: { html?: string };
	data: Pick<
		z.infer<typeof postSchema>,
		"slug" | "category" | "draft" | "published" | "related"
	>;
};
type CategoryEntry = {
	data: Pick<z.infer<typeof categorySchema>, "slug" | "name">;
};

// Checks the loaded collections as a whole, then returns the published posts
// newest first (each with its rendered html and its category's name) and the
// categories by name. The
// category and related fields are plain slugs in the schema, so an unknown one
// is caught here. Throws, naming the offender, on an empty article, a
// duplicate post or category slug, an unknown category, or a related slug
// that names no post. A related slug naming a draft is known: the post page
// leaves it out of its cards until the draft is published.
export function publishedContent<P extends PostEntry, C extends CategoryEntry>(
	entries: P[],
	categories: C[],
) {
	const names = new Map<string, string>();
	for (const { data } of categories) {
		if (names.has(data.slug)) {
			throw new Error(`Duplicate category slug: ${data.slug}`);
		}
		names.set(data.slug, data.name);
	}
	const slugs = new Set<string>();
	const posts = entries.map((post) => {
		const html = post.rendered?.html;
		if (!(post.body?.trim() && html)) {
			throw new Error(`Empty article: ${post.data.slug}`);
		}
		if (slugs.has(post.data.slug)) {
			throw new Error(`Duplicate post slug: ${post.data.slug}`);
		}
		const categoryName = names.get(post.data.category);
		if (categoryName === undefined) {
			throw new Error(
				`Unknown category: ${post.data.category} (post ${post.data.slug})`,
			);
		}
		slugs.add(post.data.slug);
		return { ...post, html, categoryName };
	});
	for (const { data } of posts) {
		const unknown = data.related.find((related) => !slugs.has(related));
		if (unknown !== undefined) {
			throw new Error(`Unknown related post: ${unknown} (post ${data.slug})`);
		}
	}
	return {
		posts: posts
			.filter((post) => !post.data.draft)
			.sort((a, b) => b.data.published.getTime() - a.data.published.getTime()),
		categories: [...categories].sort((a, b) =>
			a.data.name.localeCompare(b.data.name),
		),
	};
}

// The categories menu: each category in the given order, with how many of
// the given (published) posts it holds.
export function categoryCounts(
	posts: Pick<PostEntry, "data">[],
	categories: CategoryEntry[],
) {
	return categories.map(({ data }) => ({
		slug: data.slug,
		name: data.name,
		count: posts.filter((post) => post.data.category === data.slug).length,
	}));
}
