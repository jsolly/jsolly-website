import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { postLoader } from "./lib/blog/post-loader.js";
import { categorySchema, postSchema } from "./lib/blog/schemas.js";

const posts = defineCollection({
	loader: postLoader(),
	schema: postSchema,
});

const categories = defineCollection({
	loader: glob({
		pattern: "*.json",
		base: "./src/content/blog/categories",
		generateId: ({ entry }) => entry,
	}),
	schema: categorySchema,
});

export const collections = { posts, categories };
