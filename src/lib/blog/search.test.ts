import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
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
		// A malformed index fails to parse rather than searching partial data.
		assert.throws(() => parseSearchIndex([{ slug: "rules", title: "Rules" }]));
		assert.throws(() => parseSearchIndex({ entries: [] }));
		assert.equal(searchEntry.safeParse({ slug: "rules" }).success, false);
		// Parsing ran with zod's JIT off (the CSP has no 'unsafe-eval').
		assert.equal(z.config().jitless, true);
	});
});
