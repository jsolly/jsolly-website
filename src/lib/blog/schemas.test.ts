import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorySchema, postSchema } from "./schemas.js";

// Frontmatter as PagesCMS saves it, plus the unmanaged legacy fields.
const CMS_POST = {
	slug: "Some-Post",
	title: "A post",
	category: "Geodev",
	description: "Description",
	draft: false,
	published: "2026-10-02T14:00:23.123456-04:00",
	updated: "2026-10-02T14:00:23Z",
	legacyId: 42,
	legacyImage: "post_metaimgs/test.webp",
	legacyAuthorId: 2,
};

// The paths a post fails validation at; empty when it passes.
function failingPaths(input: unknown) {
	const result = postSchema.safeParse(input);
	return result.success
		? []
		: result.error.issues.map((issue) => issue.path.join("."));
}

describe("blog collection schemas", () => {
	it("A PagesCMS post carrying unmanaged legacy fields loads with only the managed fields and the default image", () => {
		const post = postSchema.parse(CMS_POST);
		for (const key of ["legacyId", "legacyImage", "legacyAuthorId"]) {
			assert.equal(Object.hasOwn(post, key), false, key);
		}
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

	it("A CMS edit that drops the timezone offset fails validation", () => {
		assert.deepEqual(
			failingPaths({ ...CMS_POST, published: "2026-10-02T14:00:23" }),
			["published"],
		);
	});

	it("A category slug with a space or slash fails validation", () => {
		assert.deepEqual(failingPaths({ ...CMS_POST, category: "Geo dev" }), [
			"category",
		]);
		const category = categorySchema.safeParse({
			slug: "geo/dev",
			name: "Geo Dev",
			description: "",
		});
		assert.equal(category.success, false);
		assert.deepEqual(
			category.error?.issues.map((issue) => issue.path.join(".")),
			["slug"],
		);
	});

	it("A post saved with an empty title fails validation", () => {
		assert.deepEqual(failingPaths({ ...CMS_POST, title: "" }), ["title"]);
	});
});
