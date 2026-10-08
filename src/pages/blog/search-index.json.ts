import { blogContent } from "../../lib/blog/content.js";
import { plainText } from "../../lib/blog/html.js";

// The index the search island fetches: one entry per published post, with its
// article as plain text.
export async function GET() {
	const { posts } = await blogContent();
	return Response.json(
		posts.map(({ data, html }) => ({
			slug: data.slug,
			title: data.title,
			description: data.description,
			text: plainText(html),
		})),
	);
}
