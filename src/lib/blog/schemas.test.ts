import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorySchema, postSchema } from "./schemas.js";

describe("blog collection schemas", () => {
	it("drop legacyId from posts and categories while keeping the managed fields (J19)", () => {
		const post = postSchema.parse({
			slug: "Some-Post",
			title: "A post",
			category: "Geodev",
			description: "Description",
			draft: false,
			published: "2026-10-02T14:00:23.123456-04:00",
			updated: "2026-10-02T14:00:23Z",
			legacyId: 42,
		});
		assert.equal(Object.hasOwn(post, "legacyId"), false);
		assert.equal(post.slug, "Some-Post");
		assert.equal(post.image, "/blog/media/default.webp");
		assert.equal(post.published.toISOString(), "2026-10-02T18:00:23.123Z");
		const category = categorySchema.parse({
			slug: "Geodev",
			name: "Geo Dev",
			description: "Spatial development",
			legacyId: 1,
		});
		assert.equal(Object.hasOwn(category, "legacyId"), false);
		assert.equal(category.name, "Geo Dev");
	});
});
