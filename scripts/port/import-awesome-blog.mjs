// Brings awesome-blog (SRC) files into this repository along the path map in
// path-map.mjs, one area at a time:
//
//   node scripts/port/import-awesome-blog.mjs posts categories   # B03
//   node scripts/port/import-awesome-blog.mjs --list             # the map
//   node scripts/port/import-awesome-blog.mjs --resync           # C0
//
// An area import reads SRC at `freeze_sha ?? cut_sha` (scripts/port/source.json)
// and refuses to replace a target that already differs (a step's hand edits)
// unless --overwrite is passed.
//
// --resync (C0) re-imports every content file that changed between cut_sha and
// SRC's local origin/main (C0 fetches first), applies SRC deletions, and
// records that commit as freeze_sha. It enforces the freeze itself: a
// non-content change, or a changed path under a content root that no entry
// maps, fails the run before anything is written. The J7 recipe post and the
// derived recipe library are reported and skipped. C0 only: it is the step
// that sets freeze_sha. Run rewrite-content.mjs afterwards: the re-imported
// posts are raw SRC again.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	formatJson,
	freezeRemedy,
	parseCli,
	readSource,
	runCli,
	SOURCE_JSON,
	sourceSha,
	srcBlob,
	srcCommit,
	srcFiles,
	writeDstFile,
} from "./lib.mjs";
import { AREAS, areaMappings, contentChanges } from "./path-map.mjs";

// The DST bytes for one SRC file.
function transform(entry, to, blob) {
	return entry.transform ? entry.transform(to, blob) : blob;
}

function sameBytes(dst, to, content) {
	const target = join(dst, to);
	return (
		existsSync(target) && readFileSync(target).equals(Buffer.from(content))
	);
}

function importAreas({ src, dst, names, overwrite }) {
	const sha = sourceSha(readSource(dst));
	const files = srcFiles(src, sha);
	const outputs = areaMappings(names, files).map(({ from, to, entry }) => ({
		to,
		content: transform(entry, to, srcBlob(src, sha, from)),
	}));
	const changed = outputs.filter(
		({ to, content }) => !sameBytes(dst, to, content),
	);
	const conflicts = changed.filter(({ to }) => existsSync(join(dst, to)));
	if (conflicts.length > 0 && !overwrite) {
		throw new Error(
			`these targets already differ from SRC (a step's own edits?); pass --overwrite to replace them:\n${conflicts.map(({ to }) => `  ${to}`).join("\n")}`,
		);
	}
	for (const { to, content } of changed) {
		writeDstFile(dst, to, content);
	}
	console.log(
		`✓ ${names.join(", ")} from awesome-blog@${sha.slice(0, 10)}: ${outputs.length} files, ${changed.length} written.`,
	);
	return 0;
}

// The resync's plan, decided before anything is written: what to write and
// remove, what is skipped on purpose, and what the freeze forbids.
function resyncPlan(src, cut, target) {
	const plan = {
		writes: [],
		removals: [],
		skipped: [],
		unmapped: [],
		outside: [],
	};
	for (const change of contentChanges(src, cut, target)) {
		if (change.kind === "outside") {
			plan.outside.push(change.path);
		} else if (change.kind === "unmapped") {
			plan.unmapped.push(change.path);
		} else if (change.kind === "excluded") {
			plan.skipped.push(`${change.path} (${change.reason})`);
		} else if (change.status === "D") {
			plan.removals.push(change.mapping.to);
		} else {
			const { entry, to } = change.mapping;
			plan.writes.push({
				to,
				content: transform(entry, to, srcBlob(src, target, change.path)),
			});
		}
	}
	return plan;
}

function resync({ src, dst }) {
	const source = readSource(dst);
	const target = srcCommit(src, "origin/main");
	const plan = resyncPlan(src, source.cut_sha, target);
	if (plan.outside.length > 0) {
		throw new Error(`nothing written. ${freezeRemedy(src, plan.outside)}`);
	}
	if (plan.unmapped.length > 0) {
		throw new Error(
			`these changed SRC paths sit under a content root but no path-map entry carries them; nothing written:\n${plan.unmapped.map((path) => `  ${path}`).join("\n")}`,
		);
	}
	for (const { to, content } of plan.writes) {
		writeDstFile(dst, to, content);
	}
	for (const to of plan.removals) {
		rmSync(join(dst, to), { force: true });
	}
	writeDstFile(
		dst,
		SOURCE_JSON,
		formatJson(SOURCE_JSON, { ...source, freeze_sha: target }),
	);
	console.log(
		`✓ resynced content ${source.cut_sha.slice(0, 10)}..${target.slice(0, 10)}: ${plan.writes.length} re-imported, ${plan.removals.length} removed; freeze_sha = ${target}.`,
	);
	for (const { to } of plan.writes) {
		console.log(`  imported ${to}`);
	}
	for (const skipped of plan.skipped) {
		console.log(`  skipped ${skipped}`);
	}
	for (const to of plan.removals) {
		console.warn(
			`  ⚠ removed ${to}: SRC deleted it. Decide its url-map row by hand (plan B00 remedy); the destination test fails until then.`,
		);
	}
	return 0;
}

function list() {
	for (const [name, area] of Object.entries(AREAS)) {
		console.log(`${name} (${area.step}${area.content ? ", content" : ""})`);
		for (const entry of area.entries) {
			console.log(
				`  ${entry.from} -> ${entry.to}${entry.transform ? ` [${entry.transform.name}]` : ""}`,
			);
		}
	}
	return 0;
}

function main(argv) {
	const options = parseCli(argv, {
		locations: ["src", "dst"],
		options: {
			resync: { type: "boolean" },
			overwrite: { type: "boolean" },
			list: { type: "boolean" },
		},
	});
	if (options.list) {
		return list();
	}
	if (options.resync) {
		if (options.positionals.length > 0) {
			throw new Error("--resync takes no arguments; it reads origin/main");
		}
		return resync(options);
	}
	if (options.positionals.length === 0) {
		throw new Error(
			"usage: import-awesome-blog.mjs <area>... [--overwrite] | --resync | --list  [--src <awesome-blog>] [--dst <dir>]",
		);
	}
	return importAreas({ ...options, names: options.positionals });
}

runCli(import.meta.url, main);
