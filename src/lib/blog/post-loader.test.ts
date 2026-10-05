import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePost } from "./post-loader.js";

describe("parsePost", () => {
	it("CMS YAML timestamps preserve exact source strings whether quoted or unquoted", () => {
		const timestamp = "2026-10-02T14:00:23.123456-04:00";
		for (const value of [timestamp, `"${timestamp}"`]) {
			const post = parsePost(
				`---\npublished: ${value}\nupdated: ${value}\ndraft: false\nlegacyId: 42\n---\n\n<pre><code>  kept\n</code></pre>\n`,
			);
			assert.equal(post.published, timestamp);
			assert.equal(post.updated, timestamp);
			assert.equal(post.draft, false);
			// legacyId is unmanaged PagesCMS data (J19): parsing keeps it in the
			// frontmatter, and only the collection schema, which has no such
			// field, strips it from the entry.
			assert.equal(post.legacyId, 42);
			assert.equal(post.body, "<pre><code>  kept\n</code></pre>");
		}
	});
});
