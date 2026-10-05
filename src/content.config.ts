import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { postLoader } from "./lib/blog/post-loader.js";

const SLUG = /^[A-Za-z0-9_-]+$/u;

const slug = z.string().regex(SLUG);
const timestamp = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

// legacyId, legacyImage and legacyAuthorId stay in the frontmatter as
// unmanaged PagesCMS data; the default object schema strips them (J19).
const posts = defineCollection({
	loader: postLoader(),
	schema: z.object({
		slug,
		title: z.string().min(1),
		category: slug,
		description: z.string(),
		draft: z.boolean().default(true),
		image: z.string().default("/blog/media/default.webp"),
		imageAlt: z.string().default(""),
		imageAttribution: z.string().default(""),
		imageWidth: z.number().int().positive().nullable().default(null),
		imageHeight: z.number().int().positive().nullable().default(null),
		published: timestamp,
		updated: timestamp,
		author: z.string().default("John Solly"),
		feedAuthor: z.string().default("John_Solly"),
		excerpt: z.string().default(""),
		related: z.array(slug).default([]),
	}),
});

const categories = defineCollection({
	loader: glob({
		pattern: "*.json",
		base: "./src/content/blog/categories",
		generateId: ({ entry }) => entry,
	}),
	schema: z.object({ slug, name: z.string().min(1), description: z.string() }),
});

export const collections = { posts, categories };
