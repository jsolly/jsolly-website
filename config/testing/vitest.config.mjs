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
		// Browser files own isolated processes and deployment fixtures. Three workers
		// limit competing Chromium/Node processes while retaining every case and fixture.
		maxWorkers:
			process.env.TEST_SUITE === "built"
				? 3
				: process.env.TEST_SUITE === "unit"
					? 2
					: undefined,
		// Built files own mutable deployment fixtures, so their cases stay sequential.
		// Smoke contracts share only the browser; every case owns its context and stubs.
		sequence: { hooks: "list", concurrent: process.env.TEST_SUITE === "smoke" },
		restoreMocks: true,
		// node:test had no default deadline. Browser cases retain their explicit
		// deadlines; build fixtures and hooks can legitimately take longer.
		testTimeout: 0,
		hookTimeout: 0,
	},
});
