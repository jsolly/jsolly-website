import MiniSearch from "minisearch";
import {
	articleSearchOptions,
	parseSearchIndex,
	type SearchEntry,
} from "./search.js";

type SearchSource = SearchEntry & { text: string };

export function buildSearchIndex(entries: SearchSource[]) {
	// Parse the summaries before adding sources so duplicate slugs fail with the
	// same explicit error at build time as at the fetched envelope boundary.
	const envelope = parseSearchIndex({
		version: 1,
		documents: entries.map(({ slug, title, description }) => ({
			slug,
			title,
			description,
		})),
		index: {},
	});
	const index = new MiniSearch<SearchSource>(articleSearchOptions);
	index.addAll(entries);
	return { ...envelope, index: index.toJSON() };
}
