// Static Markdown assertions need HTML facts, not a browsing context.
// parse5 preserves HTML recovery and noscript parsing without allocating a window.
import { parse } from "parse5";

const HTML = "http://www.w3.org/1999/xhtml";
const SPACE = /[\t\n\f\r ]+/u;
const HEADINGS = new Set(["h1", "h2", "h3", "h4"]);
// Every HTML heading level, deliberately independent of HEADINGS above: the
// outline must fail on a stray h5 or h6 even if the id levels ever narrow.
const OUTLINE_HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const attribute = (node, name) =>
	node?.attrs?.find((entry) => !entry.prefix && entry.name === name)?.value ??
	null;
const hasClass = (node, name) =>
	attribute(node, "class")?.split(SPACE).includes(name);
function text(node) {
	return node.nodeName === "#text"
		? node.value
		: (node.childNodes ?? []).map(text).join("");
}

export function markdownHtmlFacts(html) {
	const elements = [];
	function visit(node) {
		if (node.tagName) elements.push(node);
		// Template content is a separate fragment, outside document selectors.
		for (const child of node.childNodes ?? []) visit(child);
	}
	visit(parse(html, { scriptingEnabled: false }));
	const meta = (property) =>
		elements.find(
			(node) =>
				node.tagName === "meta" && attribute(node, "property") === property,
		);
	const link = (rel, type) =>
		elements.find(
			(node) =>
				node.tagName === "link" &&
				[
					["rel", rel],
					["type", type],
				].every(([name, expected]) => {
					const actual = attribute(node, name);
					return (
						actual !== null &&
						(node.namespaceURI === HTML ? actual.toLowerCase() : actual) ===
							expected
					);
				}),
		);
	function inArticle(node) {
		for (let parent = node.parentNode; parent; parent = parent.parentNode)
			if (hasClass(parent, "article-body")) return true;
		return false;
	}
	const body = elements.find(
		(node) => node.tagName === "body" && node.namespaceURI === HTML,
	);
	const note = elements.find(
		(node) => attribute(node, "data-context7-ask") !== null,
	);
	function inNote(node) {
		for (let parent = node.parentNode; parent; parent = parent.parentNode)
			if (parent === note) return true;
		return false;
	}
	return {
		structured: elements
			.filter(
				(node) =>
					node.tagName === "script" &&
					(node.namespaceURI === HTML
						? attribute(node, "type")?.toLowerCase()
						: attribute(node, "type")) === "application/ld+json",
			)
			.map((node) => JSON.parse(text(node))),
		headingIds: elements
			.filter(
				(node) =>
					HEADINGS.has(node.tagName) &&
					attribute(node, "id") !== null &&
					inArticle(node),
			)
			.map((node) => attribute(node, "id")),
		articleImages: elements
			.filter(
				(node) =>
					node.tagName === "img" &&
					attribute(node, "src") !== null &&
					inArticle(node),
			)
			.map((node) => attribute(node, "src")),
		openLinks: elements
			.filter((node) => node.tagName === "a" && hasClass(node, "open-button"))
			.map((node) => attribute(node, "href")),
		related: attribute(link("related", "application/json"), "href"),
		alternate: attribute(link("alternate", "text/markdown"), "href"),
		image: attribute(meta("og:image"), "content"),
		imageAlt: attribute(meta("og:image:alt"), "content"),
		title: text(elements.find((node) => node.tagName === "h1") ?? {}).trim(),
		// `elements` is document order, so this is the outline's opening level.
		firstHeading:
			elements.find((node) => OUTLINE_HEADINGS.has(node.tagName))?.tagName ??
			null,
		// The note opens the body, so a heading inside it would take that slot
		// even at h1, where firstHeading alone still reads "h1".
		noteHeading:
			elements.find(
				(node) => OUTLINE_HEADINGS.has(node.tagName) && inNote(node),
			)?.tagName ?? null,
		bodyText: text(body ?? {}),
		note: {
			hidden: attribute(note, "aria-hidden"),
			screenReaderOnly: Boolean(note && hasClass(note, "sr-only")),
			firstInBody: Boolean(
				note && body?.childNodes.find((node) => node.tagName) === note,
			),
		},
	};
}
