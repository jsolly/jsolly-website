import { fileURLToPath } from "node:url";
import { withOfflineNodeGuard } from "./node/guard.ts";

/** The production suite deliberately checks live services and is never offline. */
export function isOfflineSuite(suite: string | undefined): boolean {
	// Contract fixtures supply their own labels; they remain offline by default.
	return suite !== "production";
}

/** Native runner glue; keep setup/control-plane network access outside tests. */
export function testProcessEnvironment(
	suite: string,
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const next = { ...env, TEST_SUITE: suite };
	if (isOfflineSuite(suite)) return withOfflineNodeGuard(next);
	if (globalThis.__jsollyOfflineNodeGuard)
		throw new Error("Live production acceptance cannot inherit offline tests");
	return next;
}

/** Absolute paths also work when count-contract fixtures change Vitest's root. */
export function offlineVitestConfiguration() {
	return {
		globalSetup: [fileURLToPath(new URL("./global-setup.ts", import.meta.url))],
		setupFiles: [fileURLToPath(new URL("./setup.ts", import.meta.url))],
	};
}
