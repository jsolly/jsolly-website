import assert from "node:assert/strict";
import { it } from "vitest";
import { readLegacyJson } from "../../build/blogthedata-redirects.mjs";
import { destinationsPlan } from "../../monitoring/verify-blogthedata-cutover.mjs";
import { DIST, distFileFor, distFiles } from "./pages.mjs";

// Plan §4.2: every 301 destination in legacy/blogthedata/url-map.json must be
// built, or the old host would redirect a visitor to a jsolly.com 404. The
// destination set is the live verifier's own (destinationsPlan), so this check
// and the cutover check can never disagree on what a destination is. A page
// destination (`/x/`) needs x/index.html; any other destination (the feeds,
// recipe media, PWA files) must be that exact file, matched case-sensitively
// against distFiles.

// The destination paths with no built file in `files` (a distFiles Set).
function missingDestinations(paths, files) {
	return paths.filter((path) => !files.has(distFileFor(path)));
}

it("every blogthedata.com redirect destination exists in the build", async () => {
	assert.deepEqual(
		missingDestinations(
			["/blog/kept/", "/blog/gone/", "/blog/rss.xml", "/blog/atom.xml"],
			new Set([
				"blog/kept/index.html",
				"blog/rss.xml",
				"blog/atom.xml/index.html",
			]),
		),
		["/blog/gone/", "/blog/atom.xml"],
		"a fixture set without one page and one exact file reports both",
	);
	const files = await distFiles(DIST);
	assert.ok(
		files.has("index.html"),
		"dist/ is required: run `npm run build` first",
	);
	const paths = destinationsPlan(
		readLegacyJson("url-map.json"),
	).destinations.map((probe) => probe.path);
	assert.ok(paths.length > 0, "url-map.json has redirect destinations");
	const missing = missingDestinations(paths, files);
	console.info(
		`${paths.length - missing.length}/${paths.length} distinct redirect destinations exist in dist/`,
	);
	assert.deepEqual(missing, [], "redirect destinations missing from dist/");
});
