import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import {
	BLOG_DESCRIPTION,
	HTML_ONLY_PAGES,
	JOB_TITLE,
	RECIPES_DESCRIPTION,
} from "./identity.js";

// public/llms.txt is static text and cannot import the shared identity, so
// this holds it to the same wording the pages and agent Markdown render.
const LLMS_TXT = readFileSync(
	new URL("../../public/llms.txt", import.meta.url),
	"utf8",
);

it("an agent reading llms.txt gets the same title, blog and recipe descriptions and HTML-only contract as the site's pages", () => {
	for (const text of [
		JOB_TITLE,
		BLOG_DESCRIPTION,
		RECIPES_DESCRIPTION,
		HTML_ONLY_PAGES,
	]) {
		assert.ok(LLMS_TXT.includes(text), `llms.txt says "${text}"`);
	}
	for (const sibling of [
		"/index.md",
		"/about.md",
		"/contact.md",
		"/privacy.md",
		"/terms.md",
	]) {
		assert.ok(
			LLMS_TXT.includes(`\`${sibling}\``),
			`llms.txt lists the ${sibling} sibling`,
		);
	}
	assert.doesNotMatch(LLMS_TXT, /blogthedata\.com/u);
});
