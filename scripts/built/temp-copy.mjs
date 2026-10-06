// A throwaway copy of the working tree for built tests that need their own
// build (today: the unprocessed baseline in hydration.test.mjs, the
// maintenance build in blog-maintenance.test.mjs and the PagesCMS-shaped posts
// in blog-content-contracts.test.mjs). The real tree, its dist/ and its Astro
// data store are never touched.
//
// - Files: the `git ls-files -co --exclude-standard` set, so gitignored output
//   (dist/, .astro/, node_modules/) never comes across.
// - Dependencies: the copy gets a real node_modules/ directory that symlinks
//   every entry of the real one except .astro and .vite, so each copy keeps its
//   own Astro data store and Vite cache.
// - Guard: remove() fails when the real tree's node_modules/.astro/data-store.json
//   changed while the copy existed. Astro writes that file only for content
//   collections, so until the site has some it checks the file stays absent.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REAL_MODULES = join(ROOT, "node_modules");
const DATA_STORE = join(REAL_MODULES, ".astro", "data-store.json");
const PRIVATE_CACHES = new Set([".astro", ".vite"]);
const ASTRO_BIN = join(REAL_MODULES, "astro", "bin", "astro.mjs");

// The data store's mtime, or null while the tree has no content collections.
async function dataStoreMtime() {
	try {
		return (await fs.stat(DATA_STORE)).mtimeMs;
	} catch (error) {
		if (error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function workingTreeFiles() {
	const listed = spawnSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	if (listed.status !== 0) {
		throw new Error(`git ls-files failed: ${listed.stderr}`);
	}
	return [...new Set(listed.stdout.split("\0").filter(Boolean))];
}

async function copyFile(relative, dir) {
	const target = join(dir, relative);
	await fs.mkdir(dirname(target), { recursive: true });
	try {
		await fs.cp(join(ROOT, relative), target, { verbatimSymlinks: true });
	} catch (error) {
		// A tracked file deleted from the working tree is not part of it.
		if (error.code !== "ENOENT") {
			throw error;
		}
	}
}

async function linkModules(dir) {
	const modules = join(dir, "node_modules");
	await fs.mkdir(modules);
	const entries = await fs.readdir(REAL_MODULES);
	await Promise.all(
		entries
			.filter((entry) => !PRIVATE_CACHES.has(entry))
			.map((entry) =>
				fs.symlink(join(REAL_MODULES, entry), join(modules, entry)),
			),
	);
}

export async function createTempCopy(label) {
	const before = await dataStoreMtime();
	const dir = await fs.mkdtemp(join(tmpdir(), `jsolly-${label}-`));
	try {
		await Promise.all(
			workingTreeFiles().map((relative) => copyFile(relative, dir)),
		);
		await linkModules(dir);
	} catch (error) {
		await fs.rm(dir, { recursive: true, force: true });
		throw error;
	}
	return {
		dir,
		// `astro build` in the copy, without process-html. Returns the spawn result.
		astroBuild() {
			return spawnSync(process.execPath, [ASTRO_BIN, "build"], {
				cwd: dir,
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			});
		},
		// `npm run <script>` in the copy. Returns the spawn result.
		npmRun(script) {
			return spawnSync("npm", ["run", script], {
				cwd: dir,
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			});
		},
		// Deletes the copy (symlinks are unlinked, never followed), then checks
		// that the real data store is unchanged.
		async remove() {
			await fs.rm(dir, { recursive: true, force: true });
			const after = await dataStoreMtime();
			if (after !== before) {
				throw new Error(
					`${DATA_STORE} changed while the temp copy existed (mtime ${before} -> ${after}); a copy must never write to the real tree.`,
				);
			}
		},
	};
}
