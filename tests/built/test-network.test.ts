import assert from "node:assert/strict";
import { it } from "vitest";
import { runBrowserControls } from "../network/browser-controls/harness.ts";

it("browser transports enforce the loopback boundary without changing workers or caching", {
	timeout: 180_000,
}, async () => {
	const receipts = await runBrowserControls();
	assert.equal(receipts.length, 31);
});
