import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ID_ATTRIBUTE = /\sid="(?<id>[^"]*)"/gu;

// A fixture dist/: one portfolio page, one ported post and one recipe page.
// The post's headings are shaped as src/lib/blog/html.ts renders them (pinned
// by src/lib/blog/html.test.ts): h1-h3 get an id and a trailing "#" heading
// link, a heading with no text renders with id="" (which the id pass would
// slug to id="#"), and h4-h6 stay id-less. The comment proves skipped pages
// are still minified.
const PAGES = {
	"about/index.html": `<!doctype html><html><head><title>About</title></head><body>
<main><h2>Work History</h2><h3 id="hand-written">Kept</h3><h4>What I do now?</h4><h2>?</h2></main></body></html>`,
	"blog/conventional-commits/index.html": `<!doctype html><html><head><title>Post</title></head><body>
<main><article><h1 id="conventional-commits">Conventional Commits<a class="heading-link" href="#conventional-commits" aria-label="Link to &quot;Conventional Commits&quot;">#</a></h1>
<h2 id="why-use-them">Why use them?<a class="heading-link" href="#why-use-them" aria-label="Link to &quot;Why use them?&quot;">#</a></h2>
<h2 id=""><img src="/blog/media/x.webp" alt=""><a class="heading-link" href="#" aria-label="Link to this heading">#</a></h2>
<!-- an authoring note -->
<h4>Footnotes</h4></article></main></body></html>`,
	"recipes/chicken-posole/index.html": `<!doctype html><html><head><title>Recipe</title></head><body>
<main><h1 id="chicken-posole">Chicken Posole</h1><h2>Ingredients</h2></main></body></html>`,
};

function ids(html) {
	return [...html.matchAll(ID_ATTRIBUTE)].map((match) => match.groups.id);
}

async function processFixture() {
	const dir = await mkdtemp(join(tmpdir(), "process-html-ids-"));
	await Promise.all(
		Object.entries(PAGES).map(async ([file, html]) => {
			await mkdir(dirname(join(dir, file)), { recursive: true });
			await writeFile(join(dir, file), html);
		}),
	);
	await promisify(execFile)(process.execPath, ["process-html.mjs", dir], {
		cwd: ROOT,
	});
	const out = Object.fromEntries(
		await Promise.all(
			Object.keys(PAGES).map(async (file) => [
				file,
				await readFile(join(dir, file), "utf8"),
			]),
		),
	);
	await rm(dir, { recursive: true, force: true });
	return out;
}

it("process-html leaves blog and recipe heading ids to the article renderer and still ids portfolio headings", async () => {
	const out = await processFixture();

	for (const file of [
		"blog/conventional-commits/index.html",
		"recipes/chicken-posole/index.html",
	]) {
		assert.deepEqual(
			ids(out[file]),
			ids(PAGES[file]),
			`${file}: ids must match what the article renderer wrote`,
		);
	}
	assert.deepEqual(ids(out["about/index.html"]), [
		"work-history",
		"hand-written",
		"what-i-do-now",
	]);
	assert.ok(
		!out["blog/conventional-commits/index.html"].includes("authoring note"),
		"skipped pages are still minified",
	);
});
