// biome-ignore-all lint/suspicious/noMisplacedAssertion: Shared browser assertions called only from Vitest tests.
import assert from "node:assert/strict";

export async function assertUpdateNoticeLayout(notice) {
	const buttons = notice.locator(".update-notice-actions button");
	assert.equal(await buttons.count(), 2);
	const first = await buttons.nth(0).boundingBox();
	const later = await buttons.nth(1).boundingBox();
	assert.ok(first.height >= 44 && later.height >= 44, "44px action targets");
	assert.ok(
		later.x >= first.x + first.width + 7 ||
			later.y >= first.y + first.height + 7,
		"actions have a gap when adjacent or wrapped",
	);
	assert.equal(
		await notice.evaluate((node) => node.scrollWidth <= node.clientWidth),
		true,
	);
	const status = notice.getByRole("status");
	assert.ok(
		Number(
			await status.evaluate((node) => getComputedStyle(node).fontWeight),
		) >= 600,
	);
	await buttons.nth(0).focus();
	await buttons.nth(0).press("Tab");
	assert.equal(
		await buttons.nth(1).evaluate((node) => node === document.activeElement),
		true,
	);
}
