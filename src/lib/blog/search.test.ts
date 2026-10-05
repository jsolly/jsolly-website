import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZodError, z } from "zod";
import {
	createArticleSearch,
	parseSearchIndex,
	searchEntry,
} from "./search.js";

// Round-trips through JSON, as the island receives the index.
const index = JSON.stringify([
	{
		slug: "recipes",
		title: "Instant Pot recipes",
		description: "Fast weeknight meals",
		text: "Chicken vegetables pressure cooking",
	},
	{
		slug: "rules",
		title: "Solly Agent Rules",
		description: "Global coding instructions",
		text: "Agents must review code",
	},
	{
		slug: "mention",
		title: "Software tools",
		description: "Programming tools",
		text: "This article mentions instant pot recipes while discussing software.",
	},
]);
const search = createArticleSearch(parseSearchIndex(JSON.parse(index)));

describe("createArticleSearch", () => {
	it("A title match ranks above an incidental body mention", () => {
		assert.equal(search("instant pot")[0]?.slug, "recipes");
	});

	it("A reader finds a title despite a transposed letter or unfinished words", () => {
		assert.equal(search("recipse")[0]?.slug, "recipes");
		assert.equal(search("agen rul")[0]?.slug, "rules");
	});

	it("Unrelated and empty queries do not return arbitrary articles", () => {
		assert.deepEqual(search("zzzznomatch"), []);
		assert.deepEqual(search("   "), []);
		assert.deepEqual(search("instant rules"), []);
	});

	it("A malformed search index fails loudly instead of searching partial data", () => {
		assert.throws(
			() => parseSearchIndex([{ slug: "rules", title: "Rules" }]),
			ZodError,
		);
		assert.throws(() => parseSearchIndex({ entries: [] }), ZodError);
		assert.equal(searchEntry.safeParse({ slug: "rules" }).success, false);
	});

	it("A search index listing one slug twice fails to parse", () => {
		const entries = JSON.parse(index);
		assert.throws(
			() => parseSearchIndex([...entries, { ...entries[1], title: "Copy" }]),
			/Duplicate search index slug: rules/u,
		);
	});

	it("Search parsing runs without eval under the page CSP", () => {
		// The CSP has no 'unsafe-eval', so zod's JIT stays off for every parse.
		assert.equal(z.config().jitless, true);
		assert.equal(parseSearchIndex(JSON.parse(index)).length, 3);
	});
});
