// biome-ignore-all lint/performance/noAwaitInLoops: Each source entry and copy is completed before ownership advances.
// Private validation trees retain Git-dependent checks without sharing an index,
// Astro data store or Vite cache with the committing checkout.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";

export function privateEnvironment(env = process.env) {
	return Object.fromEntries(
		Object.entries(env).filter(
			([key]) =>
				![
					"GIT_DIR",
					"GIT_WORK_TREE",
					"GIT_COMMON_DIR",
					"GIT_INDEX_FILE",
					"GIT_OBJECT_DIRECTORY",
					"GIT_ALTERNATE_OBJECT_DIRECTORIES",
				].includes(key),
		),
	);
}

function git(root, args, env) {
	return execFileSync("git", args, {
		cwd: root,
		env,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

export async function snapshot(root, env = process.env) {
	const head = git(root, ["rev-parse", "HEAD"], env).trim();
	const index = git(root, ["write-tree"], env).trim();
	const names = [
		...new Set(
			git(
				root,
				["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
				env,
			)
				.split("\0")
				.filter(Boolean),
		),
	].sort();
	const files = [];
	const hash = createHash("sha256");
	for (const name of names) {
		let stat;
		try {
			stat = await fs.lstat(join(root, name));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (!stat.isFile() && !stat.isSymbolicLink())
			throw new Error(`Unsupported gate source: ${name}`);
		const link = stat.isSymbolicLink();
		const bytes = link
			? Buffer.from(await fs.readlink(join(root, name)))
			: await fs.readFile(join(root, name));
		const mode = stat.mode & 0o777;
		hash.update(JSON.stringify([name, mode, link, bytes.length]));
		hash.update(bytes);
		files.push({ name, mode, link, bytes });
	}
	return { head, index, digest: hash.digest("hex"), files };
}

export async function assertUnchanged(root, before, env = process.env) {
	const after = await snapshot(root, env);
	if (["head", "index", "digest"].some((key) => before[key] !== after[key])) {
		throw new Error(
			"Gate source, HEAD or staged index changed during validation; run the full gate again.",
		);
	}
}

export async function createValidationTree(
	root,
	dir,
	source,
	env = process.env,
) {
	const clean = privateEnvironment(env);
	// Shared object storage is read-only here. refs, configuration and index are private.
	git(
		root,
		[
			"-c",
			"core.hooksPath=/dev/null",
			"clone",
			"--quiet",
			"--shared",
			"--no-checkout",
			root,
			dir,
		],
		clean,
	);
	// Set detached HEAD without materializing and then deleting a checkout.
	git(dir, ["update-ref", "--no-deref", "HEAD", source.head], clean);
	git(dir, ["read-tree", source.index], clean);
	for (const { name, bytes, mode, link } of source.files) {
		const target = join(dir, name);
		await fs.mkdir(dirname(target), { recursive: true });
		if (link) await fs.symlink(bytes.toString(), target);
		else {
			await fs.writeFile(target, bytes);
			await fs.chmod(target, mode);
		}
	}
	await fs.mkdir(join(dir, "node_modules"));
	for (const name of await fs.readdir(join(root, "node_modules"))) {
		// All hidden mutable caches stay private. .bin contains only executable links.
		if (name.startsWith(".") && name !== ".bin") continue;
		await fs.symlink(
			join(root, "node_modules", name),
			join(dir, "node_modules", name),
		);
	}
	return dir;
}
