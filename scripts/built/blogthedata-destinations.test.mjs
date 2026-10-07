import assert from "node:assert/strict";
import it from "node:test";
import { readLegacyJson } from "../blogthedata-redirects.mjs";
import { destinationsPlan } from "../verify-blogthedata-cutover.mjs";
import { distFileFor, distFiles } from "./pages.mjs";

// Plan §4.2: every 301 destination in legacy/blogthedata/url-map.json must be
// built, or the old host would redirect a visitor to a jsolly.com 404. The
// destination set is the live verifier's own (destinationsPlan), so this check
// and the cutover check can never disagree on what a destination is. A page
// destination (`/x/`) needs x/index.html; any other destination (the feeds,
// recipe media, PWA files) must be that exact file, matched case-sensitively.

// The destination paths with no built file in `files` (a distFiles Set).
function missingDestinations(paths, files) {
	return paths.filter((path) => !files.has(distFileFor(path)));
}

it("every blogthedata.com redirect destination exists in the build", async (t) => {
	assert.deepEqual(
		missingDestinations(
			[
				"/blog/post/",
				"/blog/rss.xml",
				"/blog/Mixed-Case/",
				"/recipes/data/",
				"/blog/media/a%20b.webp",
				"/blog/media/gone.webp",
			],
			new Set([
				"blog/post/index.html",
				"blog/rss.xml/index.html",
				"blog/mixed-case/index.html",
				"recipes/data/x.json",
				"blog/media/a b.webp",
			]),
		),
		[
			"/blog/rss.xml",
			"/blog/Mixed-Case/",
			"/recipes/data/",
			"/blog/media/gone.webp",
		],
		"a file destination must be a file, a page needs its index.html, and case is exact",
	);
	const files = await distFiles();
	assert.ok(
		files.has("index.html"),
		"dist/ is required: run `npm run build` first",
	);
	const paths = destinationsPlan(
		readLegacyJson("url-map.json"),
	).destinations.map((probe) => probe.path);
	assert.ok(paths.length > 0, "url-map.json has redirect destinations");
	const missing = missingDestinations(paths, files);
	t.diagnostic(
		`${paths.length - missing.length}/${paths.length} distinct redirect destinations exist in dist/`,
	);
	assert.deepEqual(missing, [], "redirect destinations missing from dist/");
});
