import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createArticleSearch } from "./search.js";

const search = createArticleSearch([
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
});
