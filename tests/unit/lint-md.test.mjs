import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

const MISSING_TOOL =
	/node_modules\/\.bin\/markdownlint-cli2 not found.*npm ci/u;

it("Markdown lint fails closed when the lockfile-installed tool is missing", () => {
	const fixture = mkdtempSync(join(tmpdir(), "lint-md-"));
	try {
		mkdirSync(join(fixture, "gate"));
		mkdirSync(join(fixture, "bin"));
		copyFileSync(
			new URL("../../gate/lint-md.sh", import.meta.url),
			join(fixture, "gate/lint-md.sh"),
		);
		// An obsolete npx fallback would succeed and leave this marker.
		writeFileSync(
			join(fixture, "bin/npx"),
			'#!/bin/sh\ntouch "$PWD/npx-called"\n',
			{ mode: 0o755 },
		);
		const result = spawnSync("bash", [join(fixture, "gate/lint-md.sh")], {
			encoding: "utf8",
			timeout: 5000,
			env: {
				...process.env,
				PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
			},
		});
		assert.ifError(result.error);
		assert.equal(result.status, 1);
		assert.match(result.stderr, MISSING_TOOL);
		assert.equal(existsSync(join(fixture, "npx-called")), false);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
