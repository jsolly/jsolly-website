import type { Page } from "playwright";

/** Keep valid pages on the normal budget until a negative case's target page. */
export async function prepareSmokeStub(
	page: Page,
	url: string,
	scenarioTimeoutMs: number,
	bootstrapTimeoutMs: number,
	timeoutPath = "/",
) {
	page.setDefaultTimeout(bootstrapTimeoutMs);
	if (scenarioTimeoutMs < bootstrapTimeoutMs) {
		await page.goto(url, { timeout: bootstrapTimeoutMs });
		await page
			.getByRole("heading", { name: "Hi, I'm John Solly.", exact: true })
			.waitFor({ timeout: bootstrapTimeoutMs });
		const selectTimeout = () => {
			page.setDefaultTimeout(
				new URL(page.url()).pathname === timeoutPath
					? scenarioTimeoutMs
					: bootstrapTimeoutMs,
			);
		};
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) selectTimeout();
		});
		selectTimeout();
		return;
	}
	page.setDefaultTimeout(scenarioTimeoutMs);
	await page.goto(url);
}
