// biome-ignore-all lint/suspicious/noMisplacedAssertion: The owning testcase awaits this typed readiness helper.
import assert from "node:assert/strict";
import type { Page } from "playwright";

/** Subscribe before navigation; await completion at the offline transition. */
export function observeRecipeLibraryReadiness(
	page: Page,
	origin: string,
): () => Promise<void> {
	const summaryResponse = page.waitForResponse(
		(response) =>
			response.url().startsWith(`${origin}/recipes/data/summaries/library-`) &&
			response.request().serviceWorker() === null,
	);
	return async () => {
		const summary = await summaryResponse;
		assert.equal(summary.status(), 200);
		assert.equal(await summary.finished(), null);
		await page.locator('#meal-results[aria-busy="false"]').waitFor();
	};
}
