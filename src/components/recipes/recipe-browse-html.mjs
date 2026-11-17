import { parse, parseFragment, serialize } from "parse5";
import { browseFormValues, paginateBrowseRecipes } from "./recipe-browse.mjs";
import { recipeBrowseHref } from "./recipe-url.mjs";

const SPACE_RE = /\s+/u;
const attr = (node, name) =>
	node.attrs?.find((item) => item.name === name)?.value;
const hasClass = (node, name) =>
	(attr(node, "class") || "").split(SPACE_RE).includes(name);
function descendants(node) {
	return [node, ...(node.childNodes || []).flatMap(descendants)];
}
function setAttr(node, name, value) {
	node.attrs = node.attrs.filter((item) => item.name !== name);
	if (value !== null) node.attrs.push({ name, value: String(value) });
}
function replaceChildren(node, children) {
	node.childNodes = children;
	for (const child of children) child.parentNode = node;
}
function text(node, value) {
	replaceChildren(node, [{ nodeName: "#text", value, parentNode: node }]);
}

/** Transform only the native library, keeping the build's own cards, head and CSP. */
export function renderBrowseHTML(html, recipes, collection, state, fragments) {
	const document = parse(html, { scriptingEnabled: false });
	const nodes = descendants(document);
	const library = nodes.find((node) => hasClass(node, "meal-library"));
	const island = library?.parentNode;
	const form =
		library &&
		descendants(library).find(
			(node) => attr(node, "id") === "recipe-browse-form",
		);
	const grid =
		library &&
		descendants(library).find((node) => hasClass(node, "recipe-grid"));
	if (island?.tagName !== "astro-island" || !form || !grid) {
		throw new Error(
			"Recipe browse template is missing its library, native form or card grid.",
		);
	}
	// These requests explicitly use native browsing. Do not hydrate the old
	// canonical island over the filtered results or restore unrelated saved filters.
	island.tagName = island.nodeName = "div";
	island.attrs = [{ name: "class", value: "recipe-server-browse" }];
	setAttr(library, "aria-busy", "false");
	setAttr(library, "data-preferences-ready", "true");
	setAttr(library, "data-server-browse", "true");
	for (const node of descendants(library)) {
		if (node.tagName === "noscript") {
			const parent = node.parentNode;
			replaceChildren(
				parent,
				parent.childNodes.flatMap((child) =>
					child === node ? node.childNodes : [child],
				),
			);
		}
	}
	const controls = descendants(library).find((node) =>
		hasClass(node, "library-controls"),
	);
	if (!controls)
		throw new Error(
			"Recipe browse template is missing its collection navigation.",
		);
	replaceChildren(
		controls,
		controls.childNodes.filter((node) => hasClass(node, "collection-options")),
	);
	for (const node of descendants(library)) {
		if (
			hasClass(node, "enhanced-shuffle") ||
			hasClass(node, "recipe-print-action")
		) {
			const parent = node.parentNode;
			replaceChildren(
				parent,
				parent.childNodes.filter((child) => child !== node),
			);
		}
	}
	const values = browseFormValues(state, collection);
	for (const node of descendants(form)) {
		const name = attr(node, "name");
		if (!name || !(name in values)) continue;
		const selected = values[name];
		if (node.tagName === "select") {
			for (const option of descendants(node).filter(
				(child) => child.tagName === "option",
			)) {
				setAttr(
					option,
					"selected",
					selected.includes(attr(option, "value")) ? "" : null,
				);
			}
		} else if (node.tagName === "input") {
			if (["checkbox", "radio"].includes(attr(node, "type"))) {
				setAttr(
					node,
					"checked",
					selected.includes(attr(node, "value") || "on") ? "" : null,
				);
			} else setAttr(node, "value", selected[0] || "");
		}
	}
	const result = paginateBrowseRecipes(recipes, collection, state);
	const orderedCards = result.recipes.map((recipe) => {
		const fragment = fragments[recipe.id];
		const card =
			fragment &&
			parseFragment(fragment, { scriptingEnabled: false }).childNodes.find(
				(node) => hasClass(node, "recipe-card"),
			);
		if (!card)
			throw new Error(`Recipe browse template is missing card ${recipe.id}.`);
		for (const node of descendants(card)) {
			if (
				node.tagName === "noscript" ||
				hasClass(node, "deferred-card-image")
			) {
				const parent = node.parentNode;
				replaceChildren(
					parent,
					parent.childNodes.flatMap((child) =>
						child === node
							? node.tagName === "noscript"
								? node.childNodes
								: []
							: [child],
					),
				);
			}
		}
		for (const link of descendants(card).filter(
			(node) =>
				node.tagName === "a" &&
				attr(node, "href")?.startsWith(`/recipes/${recipe.id}/`),
		)) {
			setAttr(link, "href", recipeBrowseHref(recipe, state.settings));
		}
		return card;
	});
	replaceChildren(grid, orderedCards);
	const browse = descendants(library).find(
		(node) => attr(node, "id") === "meal-results",
	);
	setAttr(browse, "data-match-count", result.total);
	setAttr(browse, "data-page", result.page);
	const status = descendants(library).find((node) =>
		hasClass(node, "no-results"),
	);
	text(
		status,
		result.total
			? `${result.total} ${result.total === 1 ? "recipe" : "recipes"} found`
			: "No recipes match your search and filters. Try fewer words or adjust the filters.",
	);
	for (const node of descendants(library).filter(
		(candidate) =>
			hasClass(candidate, "recipe-pagination") ||
			hasClass(candidate, "load-more"),
	)) {
		const parent = node.parentNode;
		replaceChildren(
			parent,
			parent.childNodes.filter((child) => child !== node),
		);
	}
	const href = (page) => {
		const params = new URLSearchParams();
		for (const [name, selected] of Object.entries(values))
			for (const value of selected) params.append(name, value);
		params.set("page", String(page));
		return `${attr(form, "action") || (collection === "meal" ? "/recipes/meals/" : "/recipes/smoothies/")}?${params}`;
	};
	const pagination = parseFragment(
		'<nav class="recipe-pagination" aria-label="Recipe pages"></nav>',
	).childNodes.at(0);
	for (const [page, label] of [
		[result.page > 1 ? result.page - 1 : null, "Previous recipes"],
		[result.nextPage, "Next recipes"],
	]) {
		if (page === null) continue;
		const link = parseFragment("<a></a>").childNodes.at(0);
		setAttr(link, "href", href(page));
		text(link, label);
		replaceChildren(pagination, [...pagination.childNodes, link]);
	}
	replaceChildren(grid.parentNode, [...grid.parentNode.childNodes, pagination]);
	// Filters are discovery variants, never separate search-index pages.
	for (const meta of nodes.filter(
		(node) => node.tagName === "meta" && attr(node, "name") === "robots",
	))
		setAttr(meta, "content", "noindex, follow");
	return serialize(document, { scriptingEnabled: false });
}
