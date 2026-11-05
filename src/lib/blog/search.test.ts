import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ZodError, z } from "zod";
import {
	createArticleSearch,
	parseSearchIndex,
	searchEntry,
} from "./search.js";
import { buildSearchIndex } from "./search-index.server.js";

// Round-trips through JSON, as the island receives the index.
const sources = [
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
];
const index = JSON.stringify(buildSearchIndex(sources));
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
		const envelope = JSON.parse(index);
		const entries = envelope.documents;
		assert.throws(
			() =>
				parseSearchIndex({
					...envelope,
					documents: [...entries, { ...entries[1], title: "Copy" }],
				}),
			/Duplicate search index slug: rules/u,
		);
	});

	it("Search parsing runs without eval under the page CSP", () => {
		// The CSP has no 'unsafe-eval', so zod's JIT stays off for every parse.
		assert.equal(z.config().jitless, true);
		assert.equal(parseSearchIndex(JSON.parse(index)).documents.length, 3);
	});
	it("Build rejects duplicate source slugs before indexing article bodies", () => {
		assert.throws(
			() => buildSearchIndex([...sources, sources[1]]),
			/Duplicate search index slug: rules/u,
		);
	});

	it("Serialized search finds body-only terms without storing the article body", () => {
		const payload = parseSearchIndex(JSON.parse(index));
		assert.deepEqual(Object.keys(payload.documents[0]).sort(), [
			"description",
			"slug",
			"title",
		]);
		assert.equal(
			JSON.stringify(payload.index).includes(sources[0].text),
			false,
		);
		assert.equal(
			createArticleSearch(payload)("vegetables")[0]?.slug,
			"recipes",
		);
	});

	it("A corrupt or mismatched serialized index fails before searches run", () => {
		const payload = parseSearchIndex(JSON.parse(index));
		assert.throws(() =>
			createArticleSearch({ ...payload, index: { serializationVersion: -1 } }),
		);
		assert.throws(
			() =>
				createArticleSearch({
					...payload,
					documents: payload.documents.slice(1),
				}),
			/do not match/u,
		);
	});
});
