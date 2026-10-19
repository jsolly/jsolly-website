import { defineConfig } from "vitest/config";

const suites = {
	unit: ["src/**/*.test.ts", "src/**/*.test.mjs", "scripts/unit/*.test.mjs"],
	built: ["scripts/built/*.test.mjs"],
	csp: ["scripts/built-csp.test.mjs"],
	workflow: ["scripts/workflow-contracts.test.mjs"],
	production: ["scripts/production-acceptance.test.mjs"],
	smoke: ["scripts/production-smoke-scenario.test.mjs"],
};

export default defineConfig({
	test: {
		include: suites[process.env.TEST_SUITE ?? "unit"] ?? ["**/*.test.mjs"],
		pool: "forks",
		// Each file owns its browser, server and mutable globals. Tests within
		// a file stay sequential, and hooks retain node:test's declaration order.
		sequence: { hooks: "list" },
		restoreMocks: true,
		// node:test had no default deadline. Browser cases retain their explicit
		// deadlines; build fixtures and hooks can legitimately take longer.
		testTimeout: 0,
		hookTimeout: 0,
	},
});
