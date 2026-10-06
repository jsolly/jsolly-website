import { glob as globFiles, readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob, type Loader } from "astro/loaders";
import { parseFrontmatter } from "astro/markdown";
import { parseDocument } from "yaml";
import { z } from "zod";
import { POST_FILES, POSTS_DIR } from "./constants.js";
import { postSchema } from "./schemas.js";
import { postHref } from "./urls.js";

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
		pattern: POST_FILES,
		base: `./${POSTS_DIR}`,
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

// A post file's slug and `updated` time. astro.config.ts reads these at
// config load, before the content layer would name the file, so a bad file
// fails here as "Invalid post <file>: <field>: <problem>".
async function postLastmod(file: string) {
	try {
		return lastmodSchema.parse(parsePost(await readFile(file, "utf8")));
	} catch (error) {
		const problem =
			error instanceof z.ZodError
				? error.issues
						.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
						.join("; ")
				: error instanceof Error
					? error.message
					: String(error);
		throw new Error(`Invalid post ${file}: ${problem}`, { cause: error });
	}
}

// Each post's page path mapped to its `updated` time as an ISO string, read
// from the post files under `root` the way the collection loader reads them:
// the sitemap's lastmod. Throws when there is no post, so a wrong root cannot
// quietly drop every lastmod, and on a post without a valid slug and updated
// time, naming its file.
export async function postLastmods(root: string): Promise<Map<string, string>> {
	const dir = join(root, POSTS_DIR);
	const files = await Array.fromAsync(globFiles(POST_FILES, { cwd: dir }));
	if (files.length === 0) throw new Error(`No posts in ${dir}`);
	const posts = await Promise.all(
		files.map((name) => postLastmod(join(dir, name))),
	);
	return new Map(
		posts.map(({ slug, updated }) => [postHref(slug), updated.toISOString()]),
	);
}
