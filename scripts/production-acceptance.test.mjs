import assert from "node:assert/strict";
import { it } from "vitest";
import { runSmoke } from "./production-smoke.mjs";
import {
	productionUrl,
	serviceWorker,
	smoke,
	verifyClientErrorForwarding,
	verifyRecipeWorker,
	verifyRelease,
} from "./production-smoke-scenario.mjs";

const scenario = {
	productionUrl,
	serviceWorker,
	smoke,
	verifyRecipeWorker,
	verifyRelease,
};

it("the intended production release passes public navigation, content and recipe worker acceptance", async () => {
	const receipt = await runSmoke({ scenario });
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
	assert.equal(receipt.success, true, receipt.errors.join("\n"));
});

it("production client-error reports still reach CloudWatch", async () => {
	await verifyClientErrorForwarding();
});
