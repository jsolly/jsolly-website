import { blogContent } from "../../lib/blog/content.js";
import { plainText } from "../../lib/blog/html.js";
import { buildSearchIndex } from "../../lib/blog/search-index.server.js";

// Index article text once during the static build. Only short document
// summaries and MiniSearch's serialized term index reach the browser.
export async function GET() {
	const { posts } = await blogContent();
	return Response.json(
		buildSearchIndex(
			posts.map(({ data, html }) => ({
				slug: data.slug,
				title: data.title,
				description: data.description,
				text: plainText(html),
			})),
		),
	);
}
