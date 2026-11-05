import type { Page } from "playwright";

/** Give short negative cases a ready root fixture before their target wait. */
export async function prepareSmokeStub(
	page: Page,
	url: string,
	scenarioTimeoutMs: number,
	bootstrapTimeoutMs: number,
) {
	page.setDefaultTimeout(scenarioTimeoutMs);
	if (scenarioTimeoutMs < bootstrapTimeoutMs) {
		// These cases supply a valid root heading. Only bootstrap uses the existing
		// fixture budget; the smoke scenario retains its requested short default.
		await page.goto(url, { timeout: bootstrapTimeoutMs });
		await page
			.getByRole("heading", { name: "Hi, I'm John Solly.", exact: true })
			.waitFor({ timeout: bootstrapTimeoutMs });
		return;
	}
	await page.goto(url);
}
