import MiniSearch from "minisearch";
import { z } from "zod";

// The search island parses its index with zod in the browser. zod's JIT probe
// calls `new Function`, which the page CSP (no 'unsafe-eval') reports as a
// violation, so turn it off before any schema exists.
z.config({ jitless: true });

export const searchEntry = z.object({
	slug: z.string(),
	title: z.string(),
	description: z.string(),
	text: z.string(),
});
type SearchEntry = z.infer<typeof searchEntry>;

// The fetched /blog/search-index.json body; throws when it is not a list of
// entries, so the island shows its error state instead of searching garbage.
export function parseSearchIndex(json: unknown): SearchEntry[] {
	return z.array(searchEntry).parse(json);
}

export function createArticleSearch(entries: SearchEntry[]) {
	const documents = new Map(entries.map((entry) => [entry.slug, entry]));
	const index = new MiniSearch<SearchEntry>({
		idField: "slug",
		fields: ["title", "description", "text"],
		searchOptions: {
			boost: { title: 8, description: 3, text: 1 },
			combineWith: "AND",
			prefix: (term) => term.length >= 2,
			fuzzy: (term) => {
				if (term.length >= 5) return 0.25;
				return term.length === 4 ? 0.2 : false;
			},
			maxFuzzy: 2,
		},
	});
	index.addAll(entries);
	return (query: string): SearchEntry[] => {
		if (!query.trim()) return [];
		return index.search(query).flatMap((result) => {
			const entry = documents.get(result.id);
			return entry ? [entry] : [];
		});
	};
}
