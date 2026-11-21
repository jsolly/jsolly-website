import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";

export async function checkBlogMedia(directory) {
	if (!lstatSync(directory).isDirectory()) {
		throw new Error(`Expected a blog media directory: ${directory}`);
	}
	for (const entry of readdirSync(directory, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (entry.isDirectory()) continue;
		const path = join(entry.parentPath, entry.name);
		if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".webp") {
			throw new Error(`Expected a regular .webp file: ${path}`);
		}
		const data = readFileSync(path);
		if (
			data.length < 12 ||
			data.toString("latin1", 0, 4) !== "RIFF" ||
			data.toString("latin1", 8, 12) !== "WEBP" ||
			data.readUInt32LE(4) !== data.length - 8
		) {
			throw new Error(`Invalid WebP container: ${path}`);
		}
		try {
			// biome-ignore lint/performance/noAwaitInLoops: decode all frames of one image at a time to bound peak memory.
			await sharp(data, { animated: true }).stats();
		} catch (cause) {
			throw new Error(`Cannot decode WebP: ${path}`, { cause });
		}
	}
}

if (import.meta.main) await checkBlogMedia("public/blog/media");
