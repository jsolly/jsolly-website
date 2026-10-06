import { readdir, readFile } from "node:fs/promises";
import { glob, type Loader } from "astro/loaders";
import { parseFrontmatter } from "astro/markdown";
import { parseDocument } from "yaml";
import { postSchema } from "./schemas.js";
import { postHref } from "./urls.js";

const POST_FILE = /\.md$/u;
const lastmodSchema = postSchema.pick({ slug: true, updated: true });

// PagesCMS writes YAML 1.2 strings, including unquoted ISO timestamps. The
// core schema keeps them strings, so the collection schema sees the exact
// source text and rejects a timestamp without an offset. Returns the
// frontmatter mapping; the glob loader keeps the body.
export function parsePost(source: string): Record<string, unknown> {
	const { rawFrontmatter } = parseFrontmatter(source);
	const document = parseDocument(rawFrontmatter, { schema: "core" });
	const [error] = document.errors;
	if (error) throw error;
	const metadata: unknown = document.toJS();
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		throw new Error("Post frontmatter must be a YAML mapping");
	}
	return { ...metadata };
}

export function postLoader(): Loader {
	const files = glob({
		pattern: "*.md",
		base: "./src/content/blog/posts",
		generateId: ({ entry }) => entry,
	});
	return {
		name: "yaml-frontmatter-posts",
		async load(context) {
			await files.load({
				...context,
				async parseData(entry) {
					if (!entry.filePath) {
						throw new Error("Post loader requires a source file path");
					}
					const data = parsePost(await readFile(entry.filePath, "utf8"));
					// Astro's generic denotes schema output; assert it only after framework validation.
					// biome-ignore lint/nursery/noUnsafeTypeAssertion: context.parseData validates against the collection schema, which TData stands for.
					return context.parseData({ ...entry, data }) as Promise<
						typeof entry.data
					>;
				},
			});
		},
	};
}

// Each post's page path mapped to its `updated` time as an ISO string, read
// from the post files in `dir` the way the collection loader reads them. The
// sitemap's lastmod; throws when `dir` holds no post, so a wrong path cannot
// quietly drop every lastmod.
export async function postLastmods(dir: URL): Promise<Map<string, string>> {
	const files = (await readdir(dir)).filter((name) => POST_FILE.test(name));
	if (files.length === 0) throw new Error(`No posts in ${dir.href}`);
	const posts = await Promise.all(
		files.map(async (name) =>
			lastmodSchema.parse(
				parsePost(await readFile(new URL(name, dir), "utf8")),
			),
		),
	);
	return new Map(
		posts.map(({ slug, updated }) => [postHref(slug), updated.toISOString()]),
	);
}
