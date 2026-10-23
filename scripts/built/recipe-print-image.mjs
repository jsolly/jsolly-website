// biome-ignore-all lint/suspicious/noMisplacedAssertion: Shared browser assertions called only from Vitest tests.
import assert from "node:assert/strict";

export async function assertPrintImage(image) {
	await image.waitFor({ state: "visible" });
	await image.evaluate((node) => node.decode());
	const { width, height } = await image.boundingBox();
	assert.ok(width > 0 && width <= 265, `print image width: ${width}px`);
	assert.ok(height > 0 && height <= 171, `print image height: ${height}px`);
}
