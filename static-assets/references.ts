import { type DefaultTreeAdapterMap, parse } from "parse5";

const SITE = "https://www.jsolly.com";
const IMAGE =
	/^\/(?:blog\/media|recipes\/media|images)\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|gif)$/u;
const WHITESPACE = /\s+/u;
const CSS_URL = /url\(\s*["']?(?<url>[^"')\s]+)["']?\s*\)/gu;

/** Only complete first-party URLs are eligible; code examples and foreign URLs are not. */
function imageReference(value: string): string | undefined {
	if (!value.startsWith("/") && !value.startsWith(`${SITE}/`)) return undefined;
	const url = new URL(value, SITE);
	if (
		url.origin !== SITE ||
		url.search ||
		url.hash ||
		!IMAGE.test(url.pathname)
	)
		return undefined;
	return url.pathname;
}

function jsonReferences(value: unknown, paths: Set<string>): void {
	if (typeof value === "string") {
		const path = imageReference(value);
		if (path) paths.add(path);
	} else if (Array.isArray(value)) {
		for (const child of value) jsonReferences(child, paths);
	} else if (value && typeof value === "object") {
		for (const child of Object.values(value)) jsonReferences(child, paths);
	}
}
export function documentReferences(
	text: string,
	kind: "html" | "json" | "css",
): Set<string> {
	const paths = new Set<string>();
	const add = (value: string) => {
		const path = imageReference(value);
		if (path) paths.add(path);
	};
	if (kind === "json") jsonReferences(JSON.parse(text), paths);
	else if (kind === "css") {
		for (const match of text.matchAll(CSS_URL)) {
			// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket access for regex named groups.
			const value = match.groups?.["url"];
			if (value) add(value);
		}
	} else {
		const visit = (node: DefaultTreeAdapterMap["node"]): void => {
			if ("attrs" in node) {
				for (const attr of node.attrs) {
					if (["src", "href", "content", "poster"].includes(attr.name))
						add(attr.value);
					if (attr.name === "srcset") {
						for (const candidate of attr.value.split(","))
							add(candidate.trim().split(WHITESPACE)[0] ?? "");
					}
					if (attr.name === "props")
						jsonReferences(JSON.parse(attr.value), paths);
				}
				if (
					node.tagName === "script" &&
					node.attrs.some(
						(attr) =>
							attr.name === "type" && attr.value === "application/ld+json",
					)
				) {
					jsonReferences(
						JSON.parse(
							node.childNodes
								.map((child) => ("value" in child ? child.value : ""))
								.join(""),
						),
						paths,
					);
				}
			}
			if ("childNodes" in node)
				for (const child of node.childNodes) visit(child);
		};
		visit(parse(text));
	}
	return paths;
}
