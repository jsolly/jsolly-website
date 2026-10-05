import { getCollection } from "astro:content";
import { publishedContent } from "./schemas.js";

async function blogContent() {
	const [entries, categories] = await Promise.all([
		getCollection("posts"),
		getCollection("categories"),
	]);
	return publishedContent(entries, categories);
}

// The categories menu: every category by name, with its published post count.
export async function blogNavigation() {
	const { posts, categories } = await blogContent();
	return categories.map(({ data }) => ({
		slug: data.slug,
		name: data.name,
		count: posts.filter((post) => post.data.category === data.slug).length,
	}));
}
