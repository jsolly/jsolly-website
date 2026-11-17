import { DEFAULT_IMAGE } from "./constants.js";
import manifest from "./image-variants.json" with { type: "json" };

const ABSOLUTE_HTTP = /^https?:\/\//iu;
const variants: ReadonlyMap<
	string,
	{ src: string; srcset: string; width: number; height: number }
> = new Map(Object.entries(manifest));

/** Local migration families carry their measured responsive candidates. */
export function responsiveImage(path: string) {
	return variants.get(imageUrl(path));
}

/** New CMS uploads stay as authored; bare legacy upload paths must be migrated. */
export function imageUrl(path: string) {
	if (!path || path === "default.webp") return DEFAULT_IMAGE;
	if (ABSOLUTE_HTTP.test(path) || path.startsWith("/")) return path;
	throw new Error(
		`Blog images require a root-relative or absolute URL: ${path}`,
	);
}
