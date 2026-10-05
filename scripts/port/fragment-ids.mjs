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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { JSDOM } from "jsdom";
import {
	formatJson,
	git,
	parseCli,
	readSource,
	runCli,
	sourceSha,
	writeDstFile,
} from "./lib.mjs";

const OUTPUT = "legacy/blogthedata/fragment-ids.json";
const GENERATED_ID = /^bits-/u;
const MAX_BUFFER = 512 * 1024 * 1024;

function run(command, args, options) {
	const result = spawnSync(command, args, {
		stdio: ["pipe", "inherit", "inherit"],
		maxBuffer: MAX_BUFFER,
		...options,
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
	}
}

function buildSource(src, sha, dir) {
	const archive = git(src, ["archive", "--format=tar", sha], { binary: true });
	run("tar", ["-x", "-C", dir], { input: archive });
	run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir });
	run(
		process.execPath,
		[join("node_modules", "astro", "bin", "astro.mjs"), "build"],
		{ cwd: dir, env: { ...process.env, VERCEL_GIT_COMMIT_SHA: sha } },
	);
	return join(dir, "dist");
}

// `dist/post/x/index.html` → `/post/x/`; `dist/index.html` → `/`.
function oldPath(relative) {
	const directory = dirname(relative);
	return directory === "." ? "/" : `/${directory.split(sep).join("/")}/`;
}

export function pageFragmentIds(html) {
	const content = new JSDOM(html).window.document.querySelector("main");
	if (!content) {
		return [];
	}
	const ids = [...content.querySelectorAll("[id]")]
		.map((element) => element.id)
		.filter((id) => id !== "" && !GENERATED_ID.test(id));
	return [...new Set(ids)].sort();
}

function main(argv) {
	const { src, dst } = parseCli(argv);
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
