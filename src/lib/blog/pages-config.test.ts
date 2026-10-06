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
import {
	CATEGORIES_DIR,
	DEFAULT_IMAGE,
	LEGACY_MEDIA,
	POSTS_DIR,
} from "./constants.js";
import { parsePost } from "./post-loader.js";
import { categorySchema, postSchema } from "./schemas.js";
import { categoryHref, postHref } from "./urls.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BIOME = join(ROOT, "node_modules/.bin/biome");
// Frontmatter PagesCMS keeps but does not manage (J19).
const UNMANAGED = new Set(["legacyId", "legacyImage", "legacyAuthorId"]);

// The parts of .pages.yml these tests read.
const fieldSchema = z.object({
	name: z.string(),
	type: z.string(),
	required: z.boolean().optional(),
	default: z.unknown().optional(),
	description: z.string().optional(),
	pattern: z.string().optional(),
	options: z
		.object({
			collection: z.string().optional(),
			value: z.string().optional(),
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

// A field's `pattern` as PagesCMS applies it, throwing when there is none.
function fieldPattern(field: z.infer<typeof fieldSchema>) {
	if (!field.pattern) throw new Error(`Missing CMS pattern on ${field.name}`);
	return new RegExp(field.pattern, "u");
}

// PagesCMS names a new entry's file by running each `{fields.x}` token
// through slugify(value, { lower: true, strict: true }) (pages-cms
// lib/schema.ts generateFilename, simov/slugify), and only when it creates
// the entry; later saves keep the file's path. For the ASCII slugs SLUG
// allows that is: a hyphen becomes a space, strict drops everything but
// letters, digits and whitespace, then trim, collapse whitespace runs to one
// hyphen, and lowercase.
function pagesCmsSlug(value: string) {
	return value
		.replaceAll("-", " ")
		.replace(/[^A-Za-z0-9\s]/gu, "")
		.trim()
		.replace(/\s+/gu, "-")
		.toLowerCase();
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

		// Every schema key a post or category cannot omit is required in the
		// CMS, and every CMS default is the schema's own default.
		const schemas: [typeof posts, Record<string, z.ZodType>][] = [
			[posts, postSchema.shape],
			[categories, categorySchema.shape],
		];
		for (const [collection, shape] of schemas) {
			const needed = Object.keys(shape).filter(
				(key) => !shape[key]?.safeParse(undefined).success,
			);
			for (const key of needed) {
				assert.equal(collection.field(key).required, true, key);
			}
			const defaulted = collection.fields.filter(
				(field) => field.default !== undefined,
			);
			for (const field of defaulted) {
				assert.deepEqual(
					field.default,
					shape[field.name]?.parse(undefined),
					field.name,
				);
			}
		}
		for (const name of ["category", "related"]) {
			assert.equal(posts.field(name).options?.value, "{fields.slug}", name);
		}

		assert.ok(existsSync(join(ROOT, "public", DEFAULT_IMAGE)));
		assert.ok(DEFAULT_IMAGE.startsWith(`${cms.media.output}/`));
		const imagePattern = fieldPattern(posts.field("image"));
		assert.match(DEFAULT_IMAGE, imagePattern);
		assert.match(`${LEGACY_MEDIA}some.webp`, imagePattern);
		for (const rejected of ["/media/default.webp", "http://x/a.webp", ""]) {
			assert.doesNotMatch(rejected, imagePattern);
		}
		const timestamps = ["published", "updated"].map((name) => ({
			name,
			pattern: fieldPattern(posts.field(name)),
		}));
		for (const { pattern } of timestamps) {
			assert.match("2026-10-02T14:00:23.123456-04:00", pattern);
			for (const rejected of ["2026-10-02", "2026-10-02T14:00:00"]) {
				assert.doesNotMatch(rejected, pattern);
			}
		}
		assert.match(
			posts.field("slug").description ?? "",
			new RegExp(postHref("<slug>"), "u"),
		);
		assert.match(
			categories.field("slug").description ?? "",
			new RegExp(categoryHref("<slug>"), "u"),
		);

		// PagesCMS names a file from its slug only when it creates the entry,
		// so a file is named after its slug exactly (imported) or after the slug
		// as PagesCMS slugifies it (created in the CMS). Duplicate slugs are the
		// collection loader's to catch.
		assert.equal(pagesCmsSlug("Some_Post--Title-2"), "somepost-title-2");
		const accepts = (template: string, slug: string, name: string) =>
			[slug, pagesCmsSlug(slug)].some(
				(value) => template.replace("{fields.slug}", value) === name,
			);
		assert.equal(posts.filename, "{fields.slug}.md");
		for (const { name, source } of await readDir(POSTS_DIR, ".md")) {
			const raw = parsePost(source);
			const post = postSchema.parse(raw);
			assert.ok(accepts(posts.filename, post.slug, name), name);
			assert.match(post.image, imagePattern, name);
			for (const { name: key, pattern } of timestamps) {
				assert.match(String(raw[key]), pattern, `${name} ${key}`);
			}
		}
		assert.equal(categories.filename, "{fields.slug}.json");
		const categoryFiles = await readDir(CATEGORIES_DIR, ".json");
		assert.ok(categoryFiles.length > 0);
		for (const { name, source } of categoryFiles) {
			const category = categorySchema.parse(JSON.parse(source));
			assert.ok(accepts(categories.filename, category.slug, name), name);
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
