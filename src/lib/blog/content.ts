import { type CollectionEntry, getCollection } from "astro:content";

type Post = CollectionEntry<"posts"> & { html: string };

// The configured Astro `site` (astro.config.ts), so canonical and social URLs
// follow the deployment instead of a hard-coded host.
const configuredSite = import.meta.env.SITE;
if (!configuredSite) {
	throw new Error("astro.config.ts must set `site`: blog URLs are absolute");
}
export const site = configuredSite;

export async function blogContent() {
	const [entries, categories] = await Promise.all([
		getCollection("posts"),
		getCollection("categories"),
	]);
	const posts: Post[] = entries.map((post) => {
		if (!(post.body?.trim() && post.rendered?.html)) {
			throw new Error(`Empty article: ${post.data.slug}`);
		}
		return { ...post, html: post.rendered.html };
	});
	const knownCategories = new Set<string>();
	for (const category of categories) {
		if (knownCategories.has(category.data.slug)) {
			throw new Error(`Duplicate category slug: ${category.data.slug}`);
		}
		knownCategories.add(category.data.slug);
	}
	const slugs = new Set<string>();
	for (const post of posts) {
		if (slugs.has(post.data.slug)) {
			throw new Error(`Duplicate post slug: ${post.data.slug}`);
		}
		if (!knownCategories.has(post.data.category)) {
			throw new Error(`Unknown category: ${post.data.category}`);
		}
		slugs.add(post.data.slug);
	}
	return {
		posts: posts
			.filter((post) => !post.data.draft)
			.sort((a, b) => b.data.published.getTime() - a.data.published.getTime()),
		categories: categories.sort((a, b) =>
			a.data.name.localeCompare(b.data.name),
		),
	};
}
