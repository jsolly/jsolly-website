import { aroundAll, inject } from "vitest";
import { PROXY_ENVIRONMENT_KEY } from "./constants.ts";
import { isOfflineSuite, testProcessEnvironment } from "./entry.ts";
import {
	assertNoExternalNetwork,
	installNodeNetworkGuard,
} from "./node/guard.ts";

const { TEST_SUITE } = process.env;
if (isOfflineSuite(TEST_SUITE)) {
	process.env[PROXY_ENVIRONMENT_KEY] = inject("offlineNetworkProxy");
	const environment = testProcessEnvironment(TEST_SUITE ?? "unit", process.env);
	const { NODE_OPTIONS } = environment;
	Object.assign(process.env, { NODE_OPTIONS });
	installNodeNetworkGuard();
	// Wrap file afterAll hooks and returned beforeAll cleanup as well as tests.
	aroundAll(async (runSuite) => {
		try {
			await runSuite();
		} finally {
			assertNoExternalNetwork();
		}
	});
}
