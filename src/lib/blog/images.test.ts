import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import receipt from "../../../docs/blog-image-migration.json" with {
	type: "json",
};
import { articleHtml } from "./html.js";
import { imageUrl, responsiveImage } from "./images.js";

it("the complete image migration matches its authored coverage, original receipts and committed WebP bytes", () => {
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const output = execFileSync(
		"python3",
		["src/lib/blog/migrate-images.py", "--check"],
		{ cwd: root, encoding: "utf8" },
	);
	assert.match(
		output,
		/Verified \d+ authored references, \d+ original images, \d+ responsive WebPs/u,
	);
});

it("article images use measured local candidates rather than authored or legacy responsive sources", () => {
	for (const image of receipt.images) {
		const candidate = image.variants[0];
		assert.ok(candidate);
		const responsive = responsiveImage(candidate.path);
		assert.ok(responsive, image.source);
		const html = articleHtml(
			`<img src="${candidate.path}" srcset="https://example.invalid/old.png 960w" alt="Original image">`,
		);
		assert.ok(html.includes(`srcset="${responsive.srcset}"`), image.source);
		assert.ok(html.includes(`width="${responsive.width}"`), image.source);
		assert.ok(html.includes(`height="${responsive.height}"`), image.source);
		assert.match(html, /sizes="\(max-width: 960px\)/u);
		assert.doesNotMatch(html, /example\.invalid|cloudfront\.net/u);
	}
});

it("CMS uploads and the local default retain their authored URLs; bare legacy upload paths fail", () => {
	assert.equal(
		imageUrl("/blog/media/new-upload.webp"),
		"/blog/media/new-upload.webp",
	);
	assert.equal(imageUrl(""), "/blog/media/default.webp");
	assert.equal(responsiveImage("/blog/media/new-upload.webp"), undefined);
	assert.throws(() => imageUrl("post_imgs/not-migrated.png"), /root-relative/u);
	assert.throws(
		() => imageUrl("mediafiles/not-migrated.png"),
		/root-relative/u,
	);
});
