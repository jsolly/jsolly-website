// biome-ignore-all lint/suspicious/noMisplacedAssertion lint/nursery/noConditionalExpect: Node assertions validate external CI evidence at runtime, not test expectations.
// CI artifact and coverage contracts. Only Node built-ins, so the final required
// check can validate reports without installing or executing dependencies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const BUILT_FILE = /^scripts\/built\/[a-z0-9-]+\.test\.mjs$/u;
const SHA = /^[0-9a-f]{40}$/u;
const POSITIVE = /^[1-9][0-9]*$/u;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allowedPath = (path) =>
	typeof path === "string" &&
	!path.includes("\\") &&
	!path.split("/").some((part) => !part || part === "." || part === "..") &&
	(path.startsWith("dist/") ||
		path.startsWith(".recipe-browse/") ||
		path === "src/generated/route-manifest.js");

export function identity(root, env = process.env) {
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const result = {
		sha: git("rev-parse", "HEAD"),
		tree: git("rev-parse", "HEAD^{tree}"),
		run: env.GITHUB_RUN_ID,
		attempt: env.GITHUB_RUN_ATTEMPT,
	};
	assert.ok(
		SHA.test(result.sha) && SHA.test(result.tree),
		"Invalid source identity",
	);
	assert.equal(
		result.sha,
		env.GITHUB_SHA,
		"Checkout differs from workflow SHA",
	);
	assert.ok(
		POSITIVE.test(result.run ?? "") && POSITIVE.test(result.attempt ?? ""),
		"Missing workflow run/attempt identity",
	);
	return result;
}

// Preparation is the only owner of the full/reuse choice. Consumers must bind
// that choice to their exact checkout and current workflow attempt.
export function verifyPreparation(result, expected, env = process.env) {
	assert.deepEqual(
		result.identity,
		expected,
		"Wrong preparation SHA/tree/run/attempt",
	);
	assert.ok(
		["full", "reuse"].includes(result.mode),
		"Invalid preparation mode",
	);
	if (result.mode === "reuse")
		assert.ok(
			env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main",
			"Unproven PR reuse",
		);
	return result.mode;
}

export function verifyManifest(manifest, expected) {
	assert.deepEqual(manifest.identity, expected, "Wrong SHA/tree/run/attempt");
	assert.ok(
		Number.isInteger(manifest.expectedTests) && manifest.expectedTests > 0,
		"Missing built count",
	);
	assert.ok(
		Array.isArray(manifest.files) && manifest.files.length > 1,
		"Missing built discovery",
	);
	assert.equal(
		new Set(manifest.files).size,
		manifest.files.length,
		"Duplicate discovered file",
	);
	for (const file of manifest.files)
		assert.match(file, BUILT_FILE, "Unexpected discovered path");
}

export function writeBundle(root, directory, manifest) {
	const files = [];
	const visit = (path) => {
		const info = fs.lstatSync(join(root, path));
		if (info.isDirectory()) {
			for (const name of fs.readdirSync(join(root, path)).sort())
				visit(`${path}/${name}`);
		} else {
			assert.ok(
				info.isFile() && allowedPath(path),
				`Unexpected build entry: ${path}`,
			);
			const bytes = fs.readFileSync(join(root, path));
			files.push({
				path,
				sha256: digest(bytes),
				bytes: bytes.toString("base64"),
			});
		}
	};
	for (const path of [
		"dist",
		".recipe-browse",
		"src/generated/route-manifest.js",
	])
		visit(path);
	const archive = gzipSync(
		JSON.stringify({ identity: manifest.identity, files }),
	);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(join(directory, "build.json.gz"), archive);
	fs.writeFileSync(
		join(directory, "manifest.json"),
		JSON.stringify({ ...manifest, archiveSha256: digest(archive) }),
	);
}

export function restoreBundle(root, directory, expected) {
	const manifest = JSON.parse(
		fs.readFileSync(join(directory, "manifest.json"), "utf8"),
	);
	verifyManifest(manifest, expected);
	const archive = fs.readFileSync(join(directory, "build.json.gz"));
	assert.equal(
		digest(archive),
		manifest.archiveSha256,
		"Build archive digest mismatch",
	);
	const bundle = JSON.parse(gunzipSync(archive));
	assert.deepEqual(bundle.identity, expected, "Wrong build identity");
	assert.ok(
		Array.isArray(bundle.files) && bundle.files.length > 0,
		"Empty build archive",
	);
	const paths = new Set();
	const entries = bundle.files.map((file) => {
		assert.ok(
			allowedPath(file.path) && !paths.has(file.path),
			"Unsafe or duplicate build path",
		);
		paths.add(file.path);
		const bytes = Buffer.from(file.bytes, "base64");
		assert.equal(digest(bytes), file.sha256, "Build file digest mismatch");
		// Refuse symlinks at every existing component, including parent roots.
		let parent = root;
		for (const part of file.path.split("/")) {
			parent = join(parent, part);
			try {
				assert.ok(
					!fs.lstatSync(parent).isSymbolicLink(),
					"Symlink in build destination",
				);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		return { path: file.path, bytes };
	});
	assert.ok(
		paths.has("dist/release.json") &&
			paths.has("src/generated/route-manifest.js"),
		"Incomplete build archive",
	);
	// Validate the complete archive before writing any bytes. Only generated roots
	// are removed; tracked sources and dependencies cannot be overlaid.
	for (const path of ["dist", ".recipe-browse"])
		fs.rmSync(join(root, path), { recursive: true, force: true });
	for (const file of entries) {
		fs.mkdirSync(dirname(join(root, file.path)), { recursive: true });
		fs.writeFileSync(join(root, file.path), file.bytes);
	}
	return manifest;
}

export function aggregate(manifest, reports, expected, expectedTests) {
	verifyManifest(manifest, expected);
	assert.equal(
		manifest.expectedTests,
		expectedTests,
		"Count differs from source ledger",
	);
	assert.equal(reports.length, 2, "Both shard reports required");
	const seen = new Set();
	const shards = new Set();
	let count = 0;
	for (const report of reports) {
		assert.deepEqual(
			report.identity,
			expected,
			"Wrong report SHA/tree/run/attempt",
		);
		assert.ok(
			[1, 2].includes(report.shard) && !shards.has(report.shard),
			"Duplicate or invalid shard",
		);
		shards.add(report.shard);
		assert.equal(report.exitCode, 0, "Shard process failed");
		const result = report.result;
		assert.equal(result.success, true, "Vitest did not succeed");
		for (const key of [
			"numFailedTests",
			"numPendingTests",
			"numTodoTests",
			"numFailedTestSuites",
		])
			assert.equal(result[key], 0, `Nonzero ${key}`);
		assert.ok(
			Number.isInteger(result.numTotalTests) && result.numTotalTests > 0,
			"Missing test count",
		);
		assert.equal(result.numTotalTests, result.numPassedTests, "Unpassed tests");
		assert.ok(
			Array.isArray(result.testResults) && result.testResults.length > 0,
			"Missing file results",
		);
		let assertions = 0;
		for (const file of result.testResults) {
			assert.ok(
				!seen.has(file.name) && manifest.files.includes(file.name),
				"Duplicate or unexpected test file",
			);
			seen.add(file.name);
			assert.equal(file.status, "passed", "File did not pass");
			assert.ok(file.assertionResults.length > 0, "Empty test file");
			for (const test of file.assertionResults)
				assert.equal(test.status, "passed", "Skipped, todo or failed test");
			assertions += file.assertionResults.length;
		}
		assert.equal(
			assertions,
			result.numTotalTests,
			"Summary does not match actual assertions",
		);
		count += assertions;
	}
	assert.deepEqual(
		[...seen].sort(),
		[...manifest.files].sort(),
		"Incomplete built-file coverage",
	);
	assert.equal(count, expectedTests, "Incomplete built-test count");
	return { files: seen.size, tests: count };
}

export function relativeReport(root, result) {
	for (const file of result.testResults ?? []) {
		assert.ok(isAbsolute(file.name), "Vitest file identity is not absolute");
		file.name = relative(root, file.name).split("\\").join("/");
	}
	return result;
}
