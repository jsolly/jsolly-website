import assert from "node:assert/strict";
import { join } from "node:path";
import { it } from "vitest";
import variants from "../../src/lib/blog/image-variants.json" with {
	type: "json",
};
import { postHref } from "../../src/lib/blog/urls.js";
import { DIST, exists, publishedPosts, readBuilt } from "./pages.mjs";

const SITE = "https://www.jsolly.com";
const CANDIDATE = /^\/blog\/media\/migrated\/[a-z0-9-]+\.webp \d+w$/u;

it("published post images remain first-party and migrated families retain responsive WebP candidates", async () => {
	for (const post of await publishedPosts()) {
		// biome-ignore lint/performance/noAwaitInLoops: bound DOM memory while checking every post.
		const images = await readBuilt(postHref(post.slug), (document) =>
			[
				...document.querySelectorAll(
					".article-hero, .article-body img, .post-card img",
				),
			].map((image) => ({
				src: image.getAttribute("src"),
				srcset: image.getAttribute("srcset"),
				sizes: image.getAttribute("sizes"),
				width: Number(image.getAttribute("width")),
				height: Number(image.getAttribute("height")),
			})),
		);
		assert.ok(images.length > 0, post.slug);
		// Ordinary PagesCMS uploads and the default cover remain valid. Only
		// receipt-owned migration families promise generated responsive variants.
		await Promise.all(
			images.map(async (image) => {
				assert.ok(image.src, `${post.slug}: missing image source`);
				const url = new URL(image.src, SITE);
				if (url.protocol === "data:") return;
				assert.equal(url.origin, SITE, `${post.slug}: ${image.src}`);
				assert.ok(
					await exists(join(DIST, decodeURIComponent(url.pathname))),
					`${post.slug}: missing ${url.pathname}`,
				);
				if (!Object.hasOwn(variants, url.pathname)) return;
				assert.ok(url.pathname.endsWith(".webp"));
				assert.ok(image.srcset, `${post.slug}: missing srcset`);
				assert.ok(image.sizes, `${post.slug}: missing sizes`);
				assert.ok(image.width > 0);
				assert.ok(image.height > 0);
				for (const candidate of image.srcset.split(","))
					assert.match(candidate.trim(), CANDIDATE);
			}),
		);
	}
});
