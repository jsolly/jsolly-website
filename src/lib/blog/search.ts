import MiniSearch from "minisearch";
import { z } from "zod";

// The search island parses the small document envelope in the browser, under
// the site's CSP without unsafe-eval.
z.config({ jitless: true });

export const searchEntry = z.object({
	slug: z.string(),
	title: z.string(),
	description: z.string(),
});
export type SearchEntry = z.infer<typeof searchEntry>;

// One entry per post: a repeated slug would make two results share an id.
const searchDocuments = z.array(searchEntry).superRefine((entries, context) => {
	const seen = new Set<string>();
	for (const [position, { slug }] of entries.entries()) {
		if (seen.has(slug)) {
			context.addIssue({
				code: "custom",
				message: `Duplicate search index slug: ${slug}`,
				path: [position, "slug"],
			});
		}
		seen.add(slug);
	}
});

const searchIndex = z.object({
	version: z.literal(1),
	documents: searchDocuments,
	index: z.record(z.string(), z.unknown()),
});

// Build and load must agree on field order, tokenization and query behavior.
export const articleSearchOptions = {
	idField: "slug",
	fields: ["title", "description", "text"],
	searchOptions: {
		boost: { title: 8, description: 3, text: 1 },
		combineWith: "AND",
		prefix: (term: string) => term.length >= 2,
		fuzzy: (term: string) => {
			if (term.length >= 5) return 0.25;
			return term.length === 4 ? 0.2 : false;
		},
		maxFuzzy: 2,
	},
} satisfies ConstructorParameters<typeof MiniSearch<SearchEntry>>[0];

// Full article bodies are indexed at build time and are never stored in the
// fetched documents. MiniSearch owns its serialized index format.
export function parseSearchIndex(json: unknown) {
	return searchIndex.parse(json);
}

export function createArticleSearch(
	serialized: ReturnType<typeof parseSearchIndex>,
) {
	const documents = new Map(
		serialized.documents.map((entry) => [entry.slug, entry]),
	);
	const index = MiniSearch.loadJSON<SearchEntry>(
		JSON.stringify(serialized.index),
		articleSearchOptions,
	);
	if (
		index.documentCount !== documents.size ||
		serialized.documents.some(({ slug }) => !index.has(slug))
	) {
		throw new Error("Search index and document summaries do not match");
	}
	return (query: string): SearchEntry[] => {
		if (!query.trim()) return [];
		return index.search(query).map((result) => {
			const entry = documents.get(result.id);
			if (!entry) throw new Error(`Search hit ${result.id} has no entry`);
			return entry;
		});
	};
}
