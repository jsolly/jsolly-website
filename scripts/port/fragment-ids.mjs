// Writes legacy/blogthedata/fragment-ids.json, the fragment ids every old
// blogthedata.com page offered, from a build of awesome-blog at
// `freeze_sha ?? cut_sha` (plan §2.3 Fragments, §4.6; B06c at the cut, C0 at
// the freeze). scripts/built/legacy-fragments.test.mjs asserts each id exists
// on the page the old path redirects to, because browsers re-apply a #fragment
// across a 301.
//
//   node scripts/port/fragment-ids.mjs
//
// The build runs in a temp directory filled by `git archive`, with its own
// `npm ci`, so SRC's checkout is never touched. SRC's release.json endpoint
// needs a full SHA, passed as VERCEL_GIT_COMMIT_SHA.
//
// Shape: { source_sha, pages: { "<old path>": ["<id>", …] } }, keys and ids
// sorted. Per page it keeps the ids inside <main> (the content, its h1 and
// the recipe sections), not the chrome around it (body#top, navigation,
// site search) and not <main id="main"> itself. Empty ids (a heading with no
// text; B04 removes those headings) and bits-ui's generated `bits-*` ids are
// not fragments anyone links to. Pages without any id are left out.
//
// Widget ids inside <main> are not fragments either: form controls (the
// post's print button, the search page's input) and live status regions (the
// heading-copy and recipe-offline messages) exist for scripts and labels, and
// nothing links to them. Nor is the id of a wrapper that holds all of <main>'s
// content (privacy's section#privacy-policy): following it lands where the
// page starts anyway. Headings such as the author card's h2#about-author stay.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { JSDOM } from "jsdom";
import {
	formatJson,
	git,
	parseCli,
	readSource,
	run,
	runCli,
	sourceSha,
	writeDstFile,
} from "./lib.mjs";

const OUTPUT = "legacy/blogthedata/fragment-ids.json";
const GENERATED_ID = /^bits-/u;
const FORM_CONTROLS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

// Form controls and live status regions are script and label targets.
function isWidget(element) {
	return (
		FORM_CONTROLS.has(element.tagName) ||
		element.getAttribute("role") === "status"
	);
}

function buildSource(src, sha, dir) {
	const archive = git(src, ["archive", "--format=tar", sha], { binary: true });
	run("tar", ["-x", "-C", dir], { input: archive });
	run("npm", ["ci", "--no-audit", "--no-fund"], {
		cwd: dir,
		stdio: ["ignore", "inherit", "inherit"],
	});
	run(
		process.execPath,
		[join("node_modules", "astro", "bin", "astro.mjs"), "build"],
		{
			cwd: dir,
			env: { ...process.env, VERCEL_GIT_COMMIT_SHA: sha },
			stdio: ["ignore", "inherit", "inherit"],
		},
	);
	return join(dir, "dist");
}

// `dist/post/x/index.html` → `/post/x/`; `dist/index.html` → `/`.
function oldPath(relative) {
	const directory = dirname(relative);
	return directory === "." ? "/" : `/${directory.split(sep).join("/")}/`;
}

function pageFragmentIds(html) {
	const content = new JSDOM(html).window.document.querySelector("main");
	if (!content) {
		return [];
	}
	const wrapper =
		content.children.length === 1 ? content.firstElementChild : null;
	const ids = [...content.querySelectorAll("[id]")]
		.filter((element) => element !== wrapper && !isWidget(element))
		.map((element) => element.id)
		.filter((id) => id !== "" && !GENERATED_ID.test(id));
	return [...new Set(ids)].sort();
}

function main(argv) {
	const { src, dst } = parseCli(argv, { locations: ["src", "dst"] });
	const sha = sourceSha(readSource(dst));
	const dir = mkdtempSync(join(tmpdir(), "fragment-ids-"));
	try {
		const dist = buildSource(src, sha, dir);
		const pages = readdirSync(dist, { recursive: true })
			.filter((relative) => relative.split(sep).at(-1) === "index.html")
			.map((relative) => [
				oldPath(relative),
				pageFragmentIds(readFileSync(join(dist, relative), "utf8")),
			])
			.filter(([, ids]) => ids.length > 0)
			.sort(([a], [b]) => (a < b ? -1 : Number(a > b)));
		if (pages.length === 0) {
			throw new Error(
				`the awesome-blog@${sha.slice(0, 10)} build has no page with a fragment id; is ${dist} a real build?`,
			);
		}
		writeDstFile(
			dst,
			OUTPUT,
			formatJson(OUTPUT, {
				source_sha: sha,
				pages: Object.fromEntries(pages),
			}),
		);
		const total = pages.reduce((sum, [, ids]) => sum + ids.length, 0);
		console.log(
			`✓ wrote ${OUTPUT} from awesome-blog@${sha.slice(0, 10)}: ${total} ids on ${pages.length} pages.`,
		);
		return 0;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

runCli(import.meta.url, main);
