import assert from "node:assert/strict";
import { it } from "vitest";
import { config } from "../../vercel.js";

// Vercel builds a branch when any matching git.deploymentEnabled rule is true.
// Production stays on main and Previews come only from preview/** branches;
// the false globs keep every other branch, at any depth, from building.
it("Vercel's Git integration deploys only main and preview/** branches", () => {
	assert.deepEqual(config.git?.deploymentEnabled, {
		main: true,
		"preview/**": true,
		"*": false,
		"*/*": false,
		"*/*/*": false,
		"*/*/*/*": false,
		"**": false,
	});
});
