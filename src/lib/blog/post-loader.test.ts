import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { parsePost, postLastmods, postLoader } from "./post-loader.js";
import { postSchema } from "./schemas.js";

const TIMESTAMP = "2026-10-02T14:00:23.123456-04:00";

function cmsPost(published: string, updated = published) {
	return [
		"---",
		"slug: Some-Post",
		"title: A post",
		"category: Geodev",
		"description: Description",
		`published: ${published}`,
		`updated: ${updated}`,
		"draft: false",
		"legacyId: 42",
		"---",
		"",
		"<pre><code>  kept",
		"</code></pre>",
		"",
	].join("\n");
}

// The parts of Astro's LoaderContext the glob loader reads, with parseData
// validating against the posts schema as the content layer does.
function loaderContext(root: URL) {
	const entries = new Map<
		string,
		{ id: string; data: Record<string, unknown> }
	>();
	const context = {
		collection: "posts",
		config: { root, srcDir: new URL("src/", root) },
		// A warning (no files, unknown entry type) fails the test loudly.
		logger: {
			warn: (message: string) => {
				throw new Error(message);
			},
			error: (message: string) => {
				throw new Error(message);
			},
		},
		store: {
			keys: () => entries.keys(),
			get: (id: string) => entries.get(id),
			set: (entry: { id: string; data: Record<string, unknown> }) => {
				entries.set(entry.id, entry);
				return true;
			},
			delete: (id: string) => entries.delete(id),
		},
		generateDigest: (data: string) => String(data.length),
		parseData: ({ data }: { data: unknown }) => postSchema.parseAsync(data),
		entryTypes: new Map([
			[
				".md",
				{
					getEntryInfo: ({ contents }: { contents: string }) => ({
						body: contents,
						data: {},
					}),
				},
			],
		]),
	};
	return { context, entries };
}

describe("parsePost", () => {
	it("CMS YAML timestamps preserve exact source strings whether quoted or unquoted", () => {
		for (const value of [TIMESTAMP, `"${TIMESTAMP}"`]) {
			const post = parsePost(cmsPost(value));
			assert.equal(post.published, TIMESTAMP);
			assert.equal(post.updated, TIMESTAMP);
			assert.equal(post.draft, false);
			// legacyId is unmanaged PagesCMS data (J19): parsing keeps it in the
			// frontmatter, and only the collection schema strips it.
			assert.equal(post.legacyId, 42);
			assert.equal(Object.hasOwn(post, "body"), false);
		}
	});
});

describe("postLoader", () => {
	it("A PagesCMS post with an unquoted timestamp loads at its exact instant without legacy fields", async () => {
		const root = await mkdtemp(join(tmpdir(), "post-loader-"));
		try {
			const posts = join(root, "src/content/blog/posts");
			await mkdir(posts, { recursive: true });
			await writeFile(join(posts, "Some-Post.md"), cmsPost(TIMESTAMP));
			const { context, entries } = loaderContext(pathToFileURL(`${root}/`));
			await postLoader().load(context);
			const { data } = entries.get("Some-Post.md") ?? {};
			assert.ok(data);
			assert.equal(Object.hasOwn(data, "legacyId"), false);
			assert.deepEqual(data.published, new Date("2026-10-02T18:00:23.123Z"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("postLastmods", () => {
	it("A post saved with an offset-less or date-only updated time, or with frontmatter that is not YAML, stops the sitemap's lastmod read, naming its file (and the field)", async () => {
		const root = await mkdtemp(join(tmpdir(), "post-lastmods-"));
		try {
			const posts = join(root, "src/content/blog/posts");
			await mkdir(posts, { recursive: true });
			await writeFile(join(posts, "Some-Post.md"), cmsPost(TIMESTAMP));
			assert.deepEqual(
				await postLastmods(root),
				new Map([["/blog/Some-Post/", "2026-10-02T18:00:23.123Z"]]),
			);
			const file = join(posts, "Other-Post.md");
			const invalid = {
				message: `Invalid post ${file}: updated: Invalid ISO datetime`,
			};
			await writeFile(file, cmsPost(TIMESTAMP, "2026-10-02T14:00:23"));
			await assert.rejects(postLastmods(root), invalid);
			await writeFile(file, cmsPost(TIMESTAMP, "2026-10-02"));
			await assert.rejects(postLastmods(root), invalid);
			// A colon and space inside an unquoted title is a YAML error.
			await writeFile(
				file,
				cmsPost(TIMESTAMP).replace("title: A post", "title: CSP: a guide"),
			);
			await assert.rejects(postLastmods(root), (error: Error) =>
				error.message.startsWith(`Invalid post ${file}: `),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
