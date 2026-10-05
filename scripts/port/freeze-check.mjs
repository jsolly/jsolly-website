// Fails when awesome-blog changed anything but content since the cut (plan
// §5 B01; each Phase B PR body and C0 step 3 record its result):
//
//   git -C ~/code/awesome-blog fetch origin   # C0 fetches first; this never does
//   node scripts/port/freeze-check.mjs
//
// Compares cut_sha (scripts/port/source.json) with SRC's local origin/main.
// The freeze notice in awesome-blog's AGENTS.md at the cut allows only content
// edits (src/content/posts/**, src/content/categories/**, the two recipe JSON
// files, public/media/**) until C0. Each changed path is judged by path-map's
// classifyContentPath, the same judgment --resync applies: mapped content and
// content the port drops on purpose pass; anything else, or an origin/main
// that no longer contains the cut, fails with the B00 remedy.
import {
	freezeRemedy,
	gitStatus,
	parseCli,
	readSource,
	runCli,
	srcCommit,
} from "./lib.mjs";
import { contentChanges } from "./path-map.mjs";

function main(argv) {
	const { src, dst } = parseCli(argv, { locations: ["src", "dst"] });
	const cut = srcCommit(src, readSource(dst).cut_sha);
	const head = srcCommit(src, "origin/main");
	if (gitStatus(src, ["merge-base", "--is-ancestor", cut, head]) !== 0) {
		console.error(
			`✗ awesome-blog origin/main (${head.slice(0, 10)}) does not contain the cut ${cut.slice(0, 10)}: history was rewritten. Stop and ask John.`,
		);
		return 1;
	}
	const changes = contentChanges(src, cut, head);
	const frozen = changes
		.filter(({ kind }) => kind === "outside" || kind === "unmapped")
		.map(({ path }) => path);
	const range = `${cut.slice(0, 10)}..${head.slice(0, 10)}`;
	if (frozen.length > 0) {
		console.error(`✗ freeze-check ${range}: ${freezeRemedy(frozen)}`);
		return 1;
	}
	console.log(
		`✓ freeze-check ${range}: ${changes.length} content file(s) changed, no code changes since the cut.`,
	);
	return 0;
}

runCli(import.meta.url, main);
