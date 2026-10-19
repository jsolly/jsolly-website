import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "vitest";

for (const script of [
	"scripts/vercel-preview-comment-contract.sh",
	"scripts/vercel-preview-workflow-contract.sh",
]) {
	it(`${script} preserves its workflow contract`, () => {
		const result = spawnSync("bash", [script], { encoding: "utf8" });
		assert.ifError(result.error);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	});
}
