// Explicit local UI-preview publication only; never a merge-validation result.

import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";

// Consumer lint normalization; behavior follows dotagents b72bf7a3.
const LINE_BREAK = /[\r\n]/u;
const UI_PATH =
	/^src\/(?:components\/.*\.svelte|lib\/components\/.*\.svelte|styles\/.*\.css)$/u;
const git = (...args) =>
	execFileSync("git", args, { encoding: "utf8" }).trimEnd();
try {
	if (
		process.env.CI ||
		!/^[1-9]\d*$/u.test(process.env.FLEET_UI_PREVIEW_PR || "")
	)
		throw new Error("local preview PR context required");
	const head = git("rev-parse", "HEAD");
	if (process.env.FLEET_UI_PREVIEW_HEAD !== head)
		throw new Error("preview context does not match HEAD");
	const branch = git("symbolic-ref", "--short", "HEAD");
	if (branch === "main" || branch === "master")
		throw new Error("feature branch required");
	const paths = [];
	for (const args of [["--cached", "HEAD"], []]) {
		const diff = git(
			"diff",
			...args,
			"--name-status",
			"--no-renames",
			"-z",
			"--",
		).split("\0");
		for (let i = 0; i < diff.length && diff[i]; i += 2) {
			if (!["A", "M"].includes(diff[i]) || !diff[i + 1])
				throw new Error("only added or modified UI files qualify");
			paths.push(diff[i + 1]);
		}
	}
	paths.push(
		...git("ls-files", "--others", "--exclude-standard", "-z")
			.split("\0")
			.filter(Boolean),
	);
	if (
		!paths.length ||
		paths.some(
			(path) =>
				!lstatSync(path).isFile() ||
				LINE_BREAK.test(path) ||
				!UI_PATH.test(path),
		)
	)
		throw new Error(
			"only Svelte components and stylesheets qualify; run the full gate",
		);
	for (const path of paths) {
		const entry = git("ls-files", "--stage", "--", path);
		if (entry && !/^100(?:644|755) /u.test(entry))
			throw new Error("only regular UI files qualify");
	}
	console.log(
		`UI preview scope: ${paths.length} files; full merge validation still required.`,
	);
} catch (error) {
	console.error(`UI preview refused: ${error.message}`);
	process.exitCode = 1;
}
