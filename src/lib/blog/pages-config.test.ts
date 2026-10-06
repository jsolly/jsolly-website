import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { z } from "zod";
import { CATEGORIES_DIR, DEFAULT_IMAGE, POSTS_DIR } from "./constants.js";
import { parsePost } from "./post-loader.js";
import { categorySchema, postSchema } from "./schemas.js";
import { postHref } from "./urls.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BIOME = join(ROOT, "node_modules/.bin/biome");
// Frontmatter PagesCMS keeps but does not manage (J19).
const UNMANAGED = new Set(["legacyId", "legacyImage", "legacyAuthorId"]);

// The parts of .pages.yml these tests read.
const fieldSchema = z.object({
	name: z.string(),
	type: z.string(),
	default: z.unknown().optional(),
	description: z.string().optional(),
	pattern: z.string().optional(),
	options: z
		.object({
			collection: z.string().optional(),
			format: z.string().optional(),
		})
		.optional(),
});
const pagesSchema = z.object({
	media: z.object({ input: z.string(), output: z.string() }),
	settings: z.object({ content: z.object({ merge: z.boolean() }) }),
	content: z.array(
		z.object({
			name: z.string(),
			path: z.string(),
			format: z.string(),
			filename: z.string(),
			fields: z.array(fieldSchema),
		}),
	),
});

// Parses .pages.yml, throwing on a YAML error, a missing collection or a
// missing field.
async function pagesConfig() {
	const document = parseDocument(
		await readFile(join(ROOT, ".pages.yml"), "utf8"),
	);
	const [error] = document.errors;
	if (error) throw error;
	const config = pagesSchema.parse(document.toJS());
	const collection = (name: string) => {
		const found = config.content.find((entry) => entry.name === name);
		if (!found) throw new Error(`Missing CMS collection ${name}`);
		const field = (fieldName: string) => {
			const match = found.fields.find((entry) => entry.name === fieldName);
			if (!match) throw new Error(`Missing CMS field ${name}.${fieldName}`);
			return match;
		};
		return { ...found, field };
	};
	return { ...config, collection };
}

async function readDir(dir: string, extension: string) {
	const names = (await readdir(join(ROOT, dir))).filter((name) =>
		name.endsWith(extension),
	);
	return Promise.all(
		names.map(async (name) => ({
			name,
			source: await readFile(join(ROOT, dir, name), "utf8"),
		})),
	);
}

function biomeCi(cwd: string) {
	// The gate's biome step, without VCS: the temp copy has no git repository,
	// and the categories override lives in `overrides`, not the ignore file.
	return spawnSync(
		BIOME,
		["ci", ".", "--error-on-warnings", "--vcs-enabled=false", "--colors=off"],
		{ cwd, encoding: "utf8" },
	);
}

describe(".pages.yml", () => {
	it("CMS fields cover authored metadata and preserve unmanaged migration data", async () => {
		const cms = await pagesConfig();
		assert.equal(cms.settings.content.merge, true);
		const posts = cms.collection("posts");
		const fields = new Set(posts.fields.map((field) => field.name));
		const files = await readDir(POSTS_DIR, ".md");
		assert.ok(files.length > 0);
		for (const { name, source } of files) {
			const managed = Object.keys(parsePost(source)).filter(
				(key) => !UNMANAGED.has(key),
			);
			for (const key of managed) {
				assert.ok(fields.has(key), `Missing CMS field ${key} (${name})`);
			}
		}
		assert.equal(posts.format, "yaml-frontmatter");
		assert.equal(posts.field("body").type, "code");
		assert.equal(posts.field("body").options?.format, "markdown");
		assert.equal(posts.field("draft").default, true);
	});

	it("Every .pages.yml path and field matches the content collections and their schemas", async () => {
		const cms = await pagesConfig();
		assert.equal(cms.media.input, `public${cms.media.output}`);
		assert.ok(statSync(join(ROOT, cms.media.input)).isDirectory());

		const posts = cms.collection("posts");
		const categories = cms.collection("categories");
		assert.equal(posts.path, POSTS_DIR);
		assert.equal(categories.path, CATEGORIES_DIR);
		assert.equal(categories.format, "json");
		assert.equal(posts.field("category").options?.collection, categories.name);
		assert.equal(posts.field("related").options?.collection, posts.name);
		assert.deepEqual(
			posts.fields.map((field) => field.name).sort(),
			[...Object.keys(postSchema.shape), "body"].sort(),
		);
		assert.deepEqual(
			categories.fields.map((field) => field.name).sort(),
			Object.keys(categorySchema.shape).sort(),
		);

		const image = posts.field("image");
		assert.equal(image.default, DEFAULT_IMAGE);
		assert.ok(existsSync(join(ROOT, "public", DEFAULT_IMAGE)));
		assert.ok(DEFAULT_IMAGE.startsWith(`${cms.media.output}/`));
		const imagePattern = new RegExp(image.pattern ?? "", "u");
		assert.match(DEFAULT_IMAGE, imagePattern);
		assert.match(posts.field("slug").description ?? "", /\/blog\/<slug>\//u);
		assert.equal(postHref("<slug>"), "/blog/<slug>/");

		// A save names the file from the slug, so an existing file under any
		// other name would be duplicated rather than updated.
		assert.equal(posts.filename, "{fields.slug}.md");
		for (const { name, source } of await readDir(POSTS_DIR, ".md")) {
			const post = postSchema.parse(parsePost(source));
			assert.equal(name, `${post.slug}.md`);
			assert.match(post.image, imagePattern, name);
		}
		assert.equal(categories.filename, "{fields.slug}.json");
		const categoryFiles = await readDir(CATEGORIES_DIR, ".json");
		assert.ok(categoryFiles.length > 0);
		for (const { name, source } of categoryFiles) {
			const category = categorySchema.parse(JSON.parse(source));
			assert.equal(name, `${category.slug}.json`);
		}
	});

	it("A category saved as PagesCMS writes it passes biome ci", async () => {
		// PagesCMS rewrites the whole file with JSON.stringify(x, null, 2) and no
		// final newline (pages-cms lib/serialization.ts); the committed files keep
		// that shape.
		const cmsJson = (source: string) =>
			JSON.stringify(JSON.parse(source), null, 2);
		const categoryFiles = await readDir(CATEGORIES_DIR, ".json");
		for (const { name, source } of categoryFiles) {
			assert.equal(source, cmsJson(source), name);
		}
		const [category] = categoryFiles;
		assert.ok(category);

		const dir = await mkdtemp(join(tmpdir(), "pages-config-"));
		try {
			await copyFile(join(ROOT, "biome.jsonc"), join(dir, "biome.jsonc"));
			await mkdir(join(dir, CATEGORIES_DIR), { recursive: true });
			const saved = cmsJson(category.source);
			assert.ok(!saved.endsWith("\n"));
			await writeFile(join(dir, CATEGORIES_DIR, category.name), saved);
			const passed = biomeCi(dir);
			assert.equal(passed.status, 0, passed.stdout + passed.stderr);
			// The category file and biome.jsonc itself.
			assert.match(passed.stdout + passed.stderr, /Checked 2 files\b/u);

			// The same bytes outside the categories override fail formatting, so
			// the pass above comes from the override, not an unchecked file.
			await writeFile(join(dir, "src/content/blog", category.name), saved);
			const failed = biomeCi(dir);
			assert.notEqual(failed.status, 0);
			assert.match(failed.stdout + failed.stderr, /Checked 3 files\b/u);
			assert.match(
				failed.stdout + failed.stderr,
				new RegExp(`src/content/blog/${category.name} format`, "u"),
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
