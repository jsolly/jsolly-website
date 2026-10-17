import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import it from "node:test";
import { JSDOM } from "jsdom";
import { DIST, exists } from "./pages.mjs";

// Plan §2.3 Fragments, §4.6: browsers re-apply a #fragment across a 301, so an
// old blogthedata.com deep link survives only if the page its path redirects
// to carries the same id. legacy/blogthedata/fragment-ids.json records the ids
// each old page offered (generated from the frozen source build at C0);
// url-map.json says where each old page now lives. Every destination must
// exist now that the migration is complete.
const SITE = "https://www.jsolly.com";
const OFF_SITE = "https://www.blogthedata.com/e/";
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

// Compares the recorded fragment ids (`pages`, old path to ids) with the
// built pages under `distRoot`, following the url-map.json `rows`. Returns the
// old pages without a single jsolly.com redirect, the old deep links whose
// target id is missing, the missing destination pages, and how many pages and ids were checked.
async function compareFragments(pages, rows, distRoot) {
	const mapped = Object.keys(pages).map((old) => destination(rows, old));
	const unmapped = mapped.filter((page) => page.problem);
	const built = await Promise.all(
		mapped
			.filter((page) => !page.problem)
			.map(async (page) => {
				const file = join(
					distRoot,
					page.path.endsWith("/") ? `${page.path}index.html` : page.path,
				);
				return { ...page, file, landed: await exists(file) };
			}),
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
	return {
		unmapped,
		missing,
		landed: landed.length,
		missingPages: built.filter((page) => !page.landed).map((page) => page.path),
		ids: landed.reduce((sum, { old }) => sum + pages[old].length, 0),
	};
}

// A two-page dist: one destination lost an id, one kept all of them, a third
// old page's destination is not built, and two more old pages have two
// redirect rows or one that leaves jsolly.com.
async function fixtureComparison() {
	const root = await mkdtemp(join(tmpdir(), "legacy-fragments-"));
	try {
		const page = (ids) =>
			`<!doctype html><main>${ids.map((id) => `<h2 id="${id}">${id}</h2>`).join("")}</main>`;
		await mkdir(join(root, "new-a"));
		await writeFile(join(root, "new-a/index.html"), page(["kept"]));
		await mkdir(join(root, "new-b"));
		await writeFile(join(root, "new-b/index.html"), page(["one", "two"]));
		const redirect = (source, path) => ({
			source,
			action: "redirect-301",
			destination: `${SITE}${path}`,
		});
		return await compareFragments(
			{
				"/a/": ["kept", "lost"],
				"/b/": ["one", "two"],
				"/c/": ["any"],
				"/d/": ["twice"],
				"/e/": ["away"],
			},
			[
				redirect("/a/", "/new-a/"),
				redirect("/b/", "/new-b/"),
				redirect("/c/", "/new-c/"),
				redirect("/d/", "/new-d/"),
				redirect("/d/", "/other-d/"),
				{ ...redirect("/e/", "/e/"), destination: OFF_SITE },
			],
			root,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

it("every old blogthedata.com fragment id still exists on the page its URL now redirects to", async (t) => {
	assert.deepEqual(
		await fixtureComparison(),
		{
			unmapped: [
				{ old: "/d/", problem: "2 redirect-301 rows" },
				{ old: "/e/", problem: `redirects off ${SITE} (${OFF_SITE})` },
			],
			missing: ["/a/#lost -> /new-a/#lost"],
			landed: 2,
			missingPages: ["/new-c/"],
			ids: 4,
		},
		"the comparison reports exactly the lost id on a fixture dist",
	);
	assert.ok(
		await exists(join(DIST, "index.html")),
		"dist/ is required: run `npm run build` first",
	);
	const [{ pages }, { rows }] = await Promise.all([
		readJson(FRAGMENTS),
		readJson(URL_MAP),
	]);
	assert.ok(Object.keys(pages).length > 0, "fragment-ids.json lists old pages");
	const result = await compareFragments(pages, rows, DIST);
	assert.deepEqual(
		result.unmapped,
		[],
		"each old page with fragment ids redirects to one jsolly.com page in url-map.json",
	);
	assert.deepEqual(
		result.missingPages,
		[],
		"every legacy fragment destination exists in the completed migration",
	);
	t.diagnostic(`checked ${result.ids} ids on ${result.landed} pages`);
	assert.deepEqual(
		result.missing,
		[],
		"old deep links that would lose their target",
	);
});
