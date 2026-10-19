import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { it } from "vitest";

// Astro 7's default `compressHTML: "jsx"` applies JSX whitespace rules: a
// whitespace run holding a line break next to an element is dropped, so source
// written as "Questions?" on one line and the link on the next renders
// "Questions?Get in touch". config/app/astro.ts sets `compressHTML: true`, which
// keeps that space; this test fails if the setting goes. PINNED holds strings
// the "jsx" default glued; the scan catches new ones.
const PAGES = [
	"index.html",
	"about/index.html",
	"contact/index.html",
	"privacy/index.html",
	"terms/index.html",
	"404.html",
	"500.html",
];
const FOOTER = /© \d{4} John Solly\. Privacy · Terms/u;
const PINNED = {
	"index.html": [
		"Resume (PDF)",
		"Blog — articles about geospatial development",
		"Recipes — easy meals and smoothies",
		"Start at https://www.jsolly.com/llms.txt for when-to-use guidance.",
		"Request a page with Accept: text/markdown (or fetch its .md sibling) to get",
	],
	"privacy/index.html": ["policy? Get in touch"],
	"terms/index.html": ["John Solly — jsolly.com. Questions? Get in touch."],
	"404.html": ["404 page by onlymanu"],
};
const WHITESPACE = /\s+/gu;
// Decorative aria-hidden spans (testimonial quote marks, the hero arrow) sit
// against text on purpose.
const INLINE = "a, code, strong, em, cite, span:not([aria-hidden])";
// Text before an element ends in a word or sentence punctuation; an element
// may start with anything ("/llms.txt", ".md"); text after an element starts
// with a word, an opening bracket or a dash rather than closing punctuation.
const ENDS_WORD = /[\p{L}\p{N}.?!,:;—]$/u;
const STARTS_AFTER = /^[\p{L}\p{N}(—]/u;
const ENDS_ELEMENT = /[\p{L}\p{N})]$/u;

function adjacentText(node, direction) {
	const sibling = node[direction];
	return sibling?.nodeType === node.TEXT_NODE ? sibling.textContent : "";
}

// Inline elements whose text runs straight into the neighbouring text.
function gluedPairs(body) {
	const pairs = [];
	for (const element of body.querySelectorAll(INLINE)) {
		const text = element.textContent.trim();
		if (!text) continue;
		const before = adjacentText(element, "previousSibling");
		const after = adjacentText(element, "nextSibling");
		if (ENDS_WORD.test(before)) {
			pairs.push(`${before.trim().split(WHITESPACE).at(-1)}<${text}`);
		}
		if (ENDS_ELEMENT.test(text) && STARTS_AFTER.test(after)) {
			pairs.push(`${text}>${after.trim().split(WHITESPACE)[0]}`);
		}
	}
	return pairs;
}

async function readPage(page) {
	const html = await readFile(`dist/${page}`, "utf-8");
	const { body } = new JSDOM(html).window.document;
	for (const element of body.querySelectorAll("script, style, template")) {
		element.remove();
	}
	return { body, text: body.textContent.replace(WHITESPACE, " ") };
}

it("a visitor reading any portfolio page sees a space between the copy and each link or code span", async () => {
	const rendered = await Promise.all(PAGES.map(readPage));
	const problems = [];
	for (const [index, page] of PAGES.entries()) {
		const { body, text } = rendered[index];
		if (!FOOTER.test(text)) problems.push(`${page}: footer`);
		for (const expected of PINNED[page] ?? []) {
			if (!text.includes(expected)) problems.push(`${page}: ${expected}`);
		}
		for (const pair of gluedPairs(body)) problems.push(`${page}: ${pair}`);
	}
	assert.deepEqual(problems, [], "portfolio pages run text together");
});
