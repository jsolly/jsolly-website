// Shared plumbing for the temporary blogthedata port tools (merge plan §5 B01).
// Everything in scripts/port/ is deleted at cutover step C0.
//
// - SRC is the awesome-blog repository, read only through `git -C <src>`
//   (ls-tree, show, archive, diff, rev-parse). Nothing here writes to it,
//   checks it out or fetches it; C0 fetches explicitly before freeze-check.
// - DST is this repository. `--dst <dir>` points the tools at another tree
//   with the same layout, which the hermetic tests use.
// - The SHAs come from DST's scripts/port/source.json or from SRC's local
//   origin/main, never from the command line: `cut_sha` is the B00 cut,
//   `freeze_sha` the C0 freeze (null until then). Tools that read SRC content
//   use `freeze_sha ?? cut_sha`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { JSOLLY_ORIGIN, readLegacyJson } from "../blogthedata-redirects.mjs";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const SOURCE_JSON = "scripts/port/source.json";
export const URL_MAP = "legacy/blogthedata/url-map.json";
export const URL_UNION = "legacy/blogthedata/url-union.json";
// The generated recipe post is dropped (J7); its URL re-homes at /recipes/.
export const DROPPED_RECIPE_POST = "15-minute-dump-and-go-instant-pot-recipes";
// The awesome-blog checkout on John's laptop; CI has none, and the tests pass --src.
const DEFAULT_SRC = join(homedir(), "code", "awesome-blog");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");
const FULL_SHA = /^[0-9a-f]{40}$/u;
const MAX_BUFFER = 512 * 1024 * 1024;
const FRONTMATTER = /^---\n(?<yaml>[\s\S]*?)\n---(?:\n|$)/u;
const LOCATIONS = {
	src: { type: "string" },
	dst: { type: "string" },
};

// Parses the location options a tool reads (`locations`, from "src" and
// "dst") and its own options; anything else is refused.
export function parseCli(argv, { locations = [], options = {} } = {}) {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			...Object.fromEntries(locations.map((name) => [name, LOCATIONS[name]])),
			...options,
		},
		allowPositionals: true,
		strict: true,
	});
	return {
		...values,
		...(locations.includes("src") && {
			src: resolve(values.src ?? DEFAULT_SRC),
		}),
		...(locations.includes("dst") && { dst: resolve(values.dst ?? ROOT) }),
		positionals,
	};
}

// Runs `main(argv)` (sync or async, returning an exit code) when the module is
// the entry point. A thrown error prints its message and exits 1, so every
// refusal is loud and stops a C0 sequence.
export function runCli(moduleUrl, main) {
	if (
		!process.argv[1] ||
		realpathSync(process.argv[1]) !== fileURLToPath(moduleUrl)
	) {
		return;
	}
	Promise.resolve()
		.then(() => main(process.argv.slice(2)))
		.then(
			(code) => {
				process.exitCode = code;
			},
			(error) => {
				console.error(`✗ ${error.message}`);
				process.exitCode = 1;
			},
		);
}

// spawnSync that throws on a non-zero exit. Returns stdout (a string, or a
// Buffer with `encoding: "buffer"`).
export function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		maxBuffer: MAX_BUFFER,
		...options,
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed (${result.status ?? result.signal}): ${String(result.stderr ?? "").trim()}`,
		);
	}
	return result.stdout;
}

// A hook or another tool may export GIT_DIR, GIT_INDEX_FILE and friends, which
// override `git -C`. SRC reads drop every repository-location variable and keep
// only configuration (GIT_CONFIG_*), so they always read the repo they name.
function gitEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith("GIT_") || key.startsWith("GIT_CONFIG"),
		),
	);
}

// The exit status of `git -C <repo> ...`, for commands whose status is the answer.
export function gitStatus(repo, args) {
	return spawnSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		env: gitEnv(),
	}).status;
}

export function git(repo, args, { binary = false } = {}) {
	return run("git", ["-C", repo, ...args], {
		encoding: binary ? "buffer" : "utf8",
		env: gitEnv(),
	});
}

// Resolves a revision in SRC to its full commit SHA.
export function srcCommit(src, revision) {
	return git(src, ["rev-parse", "--verify", `${revision}^{commit}`]).trim();
}

// Every tracked path in SRC at `sha`, sorted as git lists them.
export function srcFiles(src, sha) {
	return git(src, ["ls-tree", "-r", "-z", "--name-only", sha])
		.split("\0")
		.filter(Boolean);
}

// One SRC file at `sha`, as a Buffer.
export function srcBlob(src, sha, path) {
	return git(src, ["show", `${sha}:${path}`], { binary: true });
}

export function readSource(dst) {
	const source = JSON.parse(readFileSync(join(dst, SOURCE_JSON), "utf8"));
	if (!FULL_SHA.test(source.cut_sha)) {
		throw new Error(`${SOURCE_JSON} cut_sha must be a full commit SHA`);
	}
	if (source.freeze_sha !== null && !FULL_SHA.test(source.freeze_sha)) {
		throw new Error(`${SOURCE_JSON} freeze_sha must be null or a full SHA`);
	}
	return source;
}

// The SRC commit whose content the port carries: the freeze once C0 set it.
export function sourceSha(source) {
	return source.freeze_sha ?? source.cut_sha;
}

// URL_MAP or URL_UNION of a DST tree.
export function readLegacy(dst, relative) {
	return readLegacyJson(basename(relative), join(dst, dirname(relative)));
}

// Old path → root-relative jsolly path, for every exact redirect row.
export function redirectPaths(dst) {
	return new Map(
		readLegacy(dst, URL_MAP)
			.rows.filter(
				(row) => row.action === "redirect-301" && row.match === "exact",
			)
			.map((row) => [row.source, row.destination.slice(JSOLLY_ORIGIN.length)]),
	);
}

// Formats text exactly as `biome format` would format the file at `relative`
// in this repository (cwd ROOT, so the repo's biome.jsonc applies even when
// --dst points elsewhere).
export function biomeFormat(relative, text) {
	return run(BIOME, ["format", `--stdin-file-path=${relative}`], {
		cwd: ROOT,
		input: text,
	});
}

export function writeDstFile(dst, relative, content) {
	const target = join(dst, relative);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

// The Biome-formatted text of a JSON value, as the gate expects it on disk.
export function formatJson(relative, value) {
	return biomeFormat(relative, JSON.stringify(value, null, "\t"));
}

// A non-global regex's named groups for `text`, or null when it does not match.
// (Biome's inference takes `exec()` to be non-null in plain JS, so the null
// branch is spelled with `test()`.)
export function groupsOf(regex, text) {
	return regex.test(text) ? regex.exec(text).groups : null;
}

// A Markdown file's YAML frontmatter block (with its --- lines, "" when it
// has none), the YAML inside it (undefined when none) and the body after it.
export function splitFrontmatter(text) {
	const match = FRONTMATTER.test(text) ? FRONTMATTER.exec(text) : null;
	const block = match?.[0] ?? "";
	return { block, yaml: match?.groups.yaml, body: text.slice(block.length) };
}

// What to do about a non-content change in awesome-blog after the cut (plan
// B00 remedy), shared by freeze-check and --resync.
export function freezeRemedy(paths) {
	return [
		`${paths.length} non-content change(s) in awesome-blog since the cut:`,
		...paths.map((path) => `  ${path}`),
		"Port it as an extra B-step, designed and reviewed when it arises (plan B00 remedy): pin one awesome-blog SHA, port only the diffed paths including deletions and renames, keep the port's hand edits, and advance cut_sha in scripts/port/source.json (or revert it in awesome-blog with John's OK); do NOT run --resync before C0 (it sets freeze_sha).",
	].join("\n");
}
