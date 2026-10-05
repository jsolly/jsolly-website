import { getCollection } from "astro:content";
import { categoryCounts, publishedContent } from "./schemas.js";

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
	return categoryCounts(posts, categories);
}
