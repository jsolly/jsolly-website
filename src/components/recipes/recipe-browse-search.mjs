import { SERVING_CHOICES } from "./constants.mjs";
import {
	browseLibraryPath,
	loadBrowseArtifact,
	parseBrowseLibrary,
} from "./recipe-browse-library.mjs";

const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
export function browseSearchPath(release) {
	return browseLibraryPath(release).replace(
		"/recipes/data/summaries/library-",
		"/recipes/data/search/index-",
	);
}

export function parseBrowseSearch(value, release) {
	if (value?.release !== release) return parseBrowseLibrary(value, release);
	if (
		value.schemaVersion !== 1 ||
		!Array.isArray(value.indexes) ||
		!isObject(value.searchIndexes) ||
		!SERVING_CHOICES.every(
			(servings) =>
				Number.isInteger(value.searchIndexes[servings]) &&
				isObject(value.indexes[value.searchIndexes[servings]]),
		)
	)
		throw new Error("The recipe search download is incomplete. Try again.");
	return value;
}

export function loadBrowseSearch(
	release,
	{ fetcher = fetch, url = browseSearchPath(release) } = {},
) {
	return loadBrowseArtifact(
		release,
		fetcher,
		url,
		browseSearchPath(release),
		parseBrowseSearch,
	);
}

export function browseLibraryState(search, state) {
	return {
		...state,
		searchIndex: state.query.trim()
			? search.indexes[search.searchIndexes[state.settings.servings]]
			: null,
	};
}
