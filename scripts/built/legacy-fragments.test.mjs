import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { JSDOM } from "jsdom";

// Plan §2.3 Fragments, §4.6: browsers re-apply a #fragment across a 301, so an
// old blogthedata.com deep link survives only if the page its path redirects
// to carries the same id. legacy/blogthedata/fragment-ids.json records the ids
// each old page offered (scripts/port/fragment-ids.mjs, from the cut build);
// url-map.json says where each old page now lives. A destination the port has
// not built yet is skipped and counted, so the check grows as routes land.
const DIST = "dist";
const SITE = "https://www.jsolly.com";
const FRAGMENTS = new URL(
	"../../legacy/blogthedata/fragment-ids.json",
	import.meta.url,
);
const URL_MAP = new URL(
	"../../legacy/blogthedata/url-map.json",
	import.meta.url,
);

async function readJson(url) {
	return JSON.parse(await readFile(url, "utf8"));
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

// The jsolly.com path each old page 301s to, or why it has none: an old page
// with fragments needs exactly one redirect row, onto jsolly.com.
function destination(rows, old) {
	const matches = rows.filter(
		(row) => row.action === "redirect-301" && row.source === old,
	);
	if (matches.length !== 1) {
		return { old, problem: `${matches.length} redirect-301 rows` };
	}
	const target = new URL(matches[0].destination);
	return target.origin === SITE
		? { old, path: target.pathname }
		: { old, problem: `redirects off ${SITE} (${target.href})` };
}

function builtFile(path) {
	return join(DIST, path.endsWith("/") ? `${path}index.html` : path);
}

it("every old blogthedata.com fragment id still exists on the page its URL now redirects to", async (t) => {
	assert.ok(
		await exists(join(DIST, "index.html")),
		"dist/ is required: run `npm run build` first",
	);
	const [{ pages }, { rows }] = await Promise.all([
		readJson(FRAGMENTS),
		readJson(URL_MAP),
	]);
	const oldPaths = Object.keys(pages);
	assert.ok(oldPaths.length > 0, "fragment-ids.json lists old pages");
	const mapped = oldPaths.map((old) => destination(rows, old));
	assert.deepEqual(
		mapped.filter((page) => page.problem),
		[],
		"each old page with fragment ids redirects to one jsolly.com page in url-map.json",
	);
	const built = await Promise.all(
		mapped.map(async (page) => ({
			...page,
			file: builtFile(page.path),
			landed: await exists(builtFile(page.path)),
		})),
	);
	const landed = built.filter((page) => page.landed);
	const missing = (
		await Promise.all(
			landed.map(async ({ old, path, file }) => {
				const dom = new JSDOM(await readFile(file, "utf8"));
				try {
					const present = new Set(
						[...dom.window.document.querySelectorAll("[id]")].map(
							(element) => element.id,
						),
					);
					return pages[old]
						.filter((id) => !present.has(id))
						.map((id) => `${old}#${id} -> ${path}#${id}`);
				} finally {
					dom.window.close();
				}
			}),
		)
	).flat();
	const ids = landed.reduce((sum, { old }) => sum + pages[old].length, 0);
	t.diagnostic(
		`checked ${ids} ids on ${landed.length} landed pages; skipped ${built.length - landed.length} of ${built.length} old pages whose destination is not built yet`,
	);
	assert.deepEqual(missing, [], "old deep links that would lose their target");
});
