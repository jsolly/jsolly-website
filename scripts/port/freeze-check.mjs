// Fails when awesome-blog changed anything but content since the cut (plan
// §5 B01; each Phase B PR body and C0 step 3 record its result):
//
//   git -C ~/code/awesome-blog fetch origin   # C0 fetches first; this never does
//   node scripts/port/freeze-check.mjs
//
// Compares cut_sha (scripts/port/source.json) with SRC's local origin/main.
// The freeze notice in awesome-blog's AGENTS.md at the cut allows only content
// edits (src/content/posts/**, src/content/categories/**, the two recipe JSON
// files, public/media/**) until C0. A changed path counts as content only when
// a content entry of path-map.mjs carries it (or drops it on purpose, as the
// J7 recipe post), so freeze-check passes exactly what --resync can import.
// Any other path, or an origin/main that no longer contains the cut, needs the
// B00 remedy: port it as an extra B-step, or revert it in awesome-blog with
// John's OK.
import {
	git,
	gitStatus,
	parseCli,
	readSource,
	runCli,
	srcCommit,
	srcFiles,
} from "./lib.mjs";
import { contentClassifier } from "./path-map.mjs";

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
	const changes = git(src, [
		"diff",
		"--no-renames",
		"--name-status",
		"-z",
		cut,
		head,
	]).split("\0");
	const before = contentClassifier(srcFiles(src, cut));
	const after = contentClassifier(srcFiles(src, head));
	const content = [];
	const outside = [];
	for (let index = 0; index + 1 < changes.length; index += 2) {
		const [status, path] = [changes[index], changes[index + 1]];
		const { kind } = (status === "D" ? before : after)(path);
		(kind === "mapped" || kind === "excluded" ? content : outside).push(path);
	}
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
		`✓ freeze-check ${range}: ${content.length} content file(s) changed, no code changes since the cut.`,
	);
	return 0;
}

runCli(import.meta.url, main);
