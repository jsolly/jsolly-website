// A throwaway copy of the working tree for built tests that need their own
// build (today: the unprocessed baseline in hydration.test.mjs, the
// maintenance build in blog-maintenance.test.mjs, the PagesCMS-shaped posts
// in blog-content-contracts.test.mjs and the Preview build in
// recipes-preview.test.mjs). The real tree, its dist/ and its Astro
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
// - Commands: astroBuild(), npmRun() and node() run in the copy without colour
//   (CI=true makes Astro colour its error text) and return { command, status,
//   output }, the output being stdout then stderr with any escape codes
//   stripped, so tests can match error messages the same way locally and on CI.
//   npmRun() also takes extra environment variables, set as Vercel sets them.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

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
	// The caller removes the directory on failure; no link may outlive that cleanup.
	const results = await Promise.allSettled(
		entries
			.filter((entry) => !PRIVATE_CACHES.has(entry))
			.map((entry) =>
				fs.symlink(join(REAL_MODULES, entry), join(modules, entry)),
			),
	);
	const failure = results.find((result) => result.status === "rejected");
	if (failure) throw failure.reason;
}

// Runs `file args` in `dir` without colour; see Commands above.
function run(dir, file, args, command, extraEnv = {}) {
	const env = { ...process.env };
	// Vitest exports Vite's test-mode flags into the worker environment. A
	// child Astro build must compute its own production flags instead.
	for (const key of ["DEV", "PROD", "MODE"]) delete env[key];
	const result = spawnSync(file, args, {
		cwd: dir,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		// Copies deliberately omit .git. Supply their source commit explicitly,
		// as CI and Vercel do, so static release identity can still be built.
		env: {
			...env,
			// Vitest sets NODE_ENV=test. These isolated builds must reproduce the
			// production output built by the gate, including release notices.
			NODE_ENV: "production",
			GITHUB_SHA:
				process.env.GITHUB_SHA ||
				execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: ROOT,
					encoding: "utf8",
				}).trim(),
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			...extraEnv,
		},
	});
	if (result.error) {
		throw result.error;
	}
	return {
		command: `${command} in ${dir}`,
		status: result.status,
		output: stripVTControlCharacters(`${result.stdout}${result.stderr}`),
	};
}

// Throws with the command's output unless it exited 0.
export function requireSuccess({ command, status, output }) {
	if (status !== 0) {
		throw new Error(`${command} failed (exit ${status}):\n${output}`);
	}
}

export async function createTempCopy(label) {
	const before = await dataStoreMtime();
	const dir = await fs.mkdtemp(join(tmpdir(), `jsolly-${label}-`));
	try {
		// Finish every started write before the failure path removes the copy.
		const results = await Promise.allSettled(
			workingTreeFiles().map((relative) => copyFile(relative, dir)),
		);
		const failure = results.find((result) => result.status === "rejected");
		if (failure) throw failure.reason;
		await linkModules(dir);
	} catch (error) {
		await fs.rm(dir, { recursive: true, force: true });
		throw error;
	}
	return {
		dir,
		// `astro build` in the copy, without process-html.
		astroBuild() {
			return run(
				dir,
				process.execPath,
				[ASTRO_BIN, "build", "--config", "config/app/astro.ts"],
				"astro build --config config/app/astro.ts",
			);
		},
		// `npm run <script>` in the copy, with any extra environment variables.
		npmRun(script, env = {}) {
			return run(dir, "npm", ["run", script], `npm run ${script}`, env);
		},
		// `node <script>` in the copy, the script relative to its root.
		node(script, args = [], env = {}) {
			return run(
				dir,
				process.execPath,
				[script, ...args],
				`node ${script} ${args.join(" ")}`,
				env,
			);
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
