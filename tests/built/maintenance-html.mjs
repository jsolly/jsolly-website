import { parse } from "parse5";

const HTML = "http://www.w3.org/1999/xhtml";
const attribute = (node, name) =>
	node?.attrs?.find((entry) => !entry.prefix && entry.name === name)?.value ??
	null;
const text = (node) =>
	node.nodeName === "#text"
		? node.value
		: (node.childNodes ?? []).map(text).join("");

// These maintenance assertions inspect static HTML, without executing scripts.
export function maintenanceHtmlFacts(html) {
	const elements = [];
	function visit(node) {
		if (node.tagName) elements.push(node);
		// Document selectors do not enter inert template content.
		for (const child of node.childNodes ?? []) visit(child);
	}
	visit(parse(html, { scriptingEnabled: false }));
	const matches = (node, name, value) => {
		const actual = attribute(node, name);
		return (
			(node.namespaceURI === HTML ? actual?.toLowerCase() : actual) === value
		);
	};
	const main = elements.find((node) => node.tagName === "main");
	const manifest = elements.find(
		(node) => node.tagName === "link" && matches(node, "rel", "manifest"),
	);
	return {
		main: main ? text(main).replace(/\s+/gu, " ").trim() : null,
		manifest: manifest ? attribute(manifest, "href") : undefined,
		blogPostings: elements.filter(
			(node) =>
				node.tagName === "script" &&
				matches(node, "type", "application/ld+json") &&
				JSON.parse(text(node))["@type"] === "BlogPosting",
		).length,
	};
}
