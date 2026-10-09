import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { markdownSiblingPath } from "../lib/accept-negotiate.js";
import { MARKDOWN_GUIDANCE, MARKDOWN_PATHS } from "./agent-pages.js";
import {
	BLOG_DESCRIPTION,
	JOB_TITLE,
	RECIPES_DESCRIPTION,
	ROLE,
	SHORT_ROLE,
} from "./constants.js";

// public/llms.txt is static text and cannot import the shared constants, so
// this holds it to the same wording the pages and agent Markdown render.
const LLMS_TXT = readFileSync(
	new URL("../../public/llms.txt", import.meta.url),
	"utf8",
);

it("an agent reading llms.txt gets the same title, role, blog and recipe descriptions and Markdown contract as the site's pages", () => {
	for (const text of [
		JOB_TITLE,
		ROLE,
		BLOG_DESCRIPTION,
		RECIPES_DESCRIPTION,
		MARKDOWN_GUIDANCE,
	]) {
		assert.ok(LLMS_TXT.includes(text), `llms.txt says "${text}"`);
	}
	assert.equal(SHORT_ROLE, "CTO & Software Engineer");
	assert.equal(
		MARKDOWN_PATHS.length,
		5,
		"five inline portfolio variants; generated blog and recipe siblings are checked against the build",
	);
	for (const sibling of MARKDOWN_PATHS.map(markdownSiblingPath)) {
		assert.ok(
			LLMS_TXT.includes(`\`${sibling}\``),
			`llms.txt lists the ${sibling} sibling`,
		);
	}
	assert.doesNotMatch(LLMS_TXT, /blogthedata\.com/u);
});
