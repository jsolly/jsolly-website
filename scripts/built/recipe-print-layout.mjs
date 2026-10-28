// biome-ignore-all lint/suspicious/noMisplacedAssertion: Shared browser assertions called only from Vitest tests.
import assert from "node:assert/strict";

export async function assertPrintLayout(image) {
	assert.equal(
		await image.isVisible(),
		false,
		"recipe illustrations are omitted from print",
	);
	const document = image.locator(
		"xpath=ancestor::div[contains(@class,'recipe-content')]",
	);
	assert.equal(await document.locator(".flow-print-title").isVisible(), true);
	assert.equal(await document.locator(".trn-table").isVisible(), true);
	assert.equal(await document.locator(".flow-screen-title").isVisible(), false);
	assert.equal(await document.locator(".detail-summary").isVisible(), false);
	assert.equal(await document.locator(".source-credit").isVisible(), false);
	assert.equal(await document.locator(".detail-facts").isVisible(), false);
}
