import assert from "node:assert/strict";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { it } from "vitest";
import { checkBlogMedia } from "../../build/check-blog-media.mjs";

const cover = new URL("../../public/blog/media/default.webp", import.meta.url);

async function nestedUpload(t) {
	const media = await mkdtemp(join(tmpdir(), "blog-media-"));
	t.onTestFinished(() => rm(media, { recursive: true, force: true }));
	const album = join(media, "album");
	await mkdir(album);
	return { media, album };
}

it("accepts a genuine WebP in a nested media folder", async (t) => {
	const { media, album } = await nestedUpload(t);
	await copyFile(cover, join(album, "cover.webp"));
	await assert.doesNotReject(checkBlogMedia(media));
});

it("rejects a WebP with readable dimensions but truncated image data", async (t) => {
	const { media, album } = await nestedUpload(t);
	const valid = await sharp(await readFile(cover))
		.resize(48, 48)
		.removeAlpha()
		.webp()
		.toBuffer();
	// Preserve the simple WebP's RIFF and VP8 chunk headers and sizes.
	assert.equal(valid.toString("latin1", 12, 16), "VP8 ");
	const truncated = valid.subarray(0, 2 * Math.floor(valid.length / 4));
	truncated.writeUInt32LE(truncated.length - 8, 4);
	truncated.writeUInt32LE(truncated.length - 20, 16);
	assert.equal((await sharp(truncated).metadata()).width, 48);
	const path = join(album, "truncated.webp");
	await writeFile(path, truncated);
	await assert.rejects(checkBlogMedia(media), {
		message: `Cannot decode WebP: ${path}`,
	});
});

it("rejects a genuine WebP with a disallowed extension", async (t) => {
	const { media, album } = await nestedUpload(t);
	const path = join(album, "cover.svg");
	await copyFile(cover, path);
	await assert.rejects(checkBlogMedia(media), {
		message: `Expected a regular .webp file: ${path}`,
	});
});
