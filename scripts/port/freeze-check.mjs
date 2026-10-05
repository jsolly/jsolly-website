// Fails when awesome-blog changed anything but content since the cut (plan
// §5 B01; each Phase B PR body and C0 step 3 record its result):
//
//   git -C ~/code/awesome-blog fetch origin   # C0 fetches first; this never does
//   node scripts/port/freeze-check.mjs
//
// Compares cut_sha (scripts/port/source.json) with SRC's local origin/main.
// The allowlist is the freeze notice in awesome-blog's AGENTS.md at the cut:
// only content edits are allowed until C0. Any other path, or an origin/main
// that no longer contains the cut, needs the B00 remedy: port it as an extra
// B-step, or revert it in awesome-blog with John's OK.
import {
	git,
	gitStatus,
	parseCli,
	readSource,
	runCli,
	srcCommit,
} from "./lib.mjs";

// Entries ending in "/" cover everything below them.
const CONTENT_ALLOWLIST = [
	"src/content/posts/",
	"src/content/categories/",
	"src/components/recipes/recipes.json",
	"src/components/recipes/nutrition-data.json",
	"public/media/",
];

function isContent(path) {
	return CONTENT_ALLOWLIST.some((allowed) =>
		allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed,
	);
}

function main(argv) {
	const { src, dst } = parseCli(argv);
	const cut = readSource(dst).cut_sha;
	srcCommit(src, cut);
	const head = srcCommit(src, "origin/main");
	const ancestor = gitStatus(src, ["merge-base", "--is-ancestor", cut, head]);
	if (ancestor.status !== 0) {
		console.error(
			`✗ awesome-blog origin/main (${head.slice(0, 10)}) does not contain the cut ${cut.slice(0, 10)}: history was rewritten. Stop and ask John.`,
		);
		return 1;
	}
	const changed = git(src, [
		"diff",
		"--no-renames",
		"--name-only",
		"-z",
		cut,
		head,
	])
		.split("\0")
		.filter(Boolean);
	const outside = changed.filter((path) => !isContent(path));
	const range = `${cut.slice(0, 10)}..${head.slice(0, 10)}`;
	if (outside.length > 0) {
		console.error(
			`✗ freeze-check ${range}: ${outside.length} non-content change(s) since the cut (B00 remedy needed):`,
		);
		for (const path of outside) {
			console.error(`  ${path}`);
		}
		return 1;
	}
	console.log(
		`✓ freeze-check ${range}: ${changed.length} content file(s) changed, no code changes since the cut.`,
	);
	return 0;
}

runCli(import.meta.url, main);
