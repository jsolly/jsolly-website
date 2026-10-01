// biome-ignore-all lint/suspicious/noMisplacedAssertion: This exported scenario is executed by the production smoke runner.
import assert from "node:assert/strict";

const CONTACT_HEADING = /Contact/iu;
const MARKDOWN_TYPE = /text\/markdown/u;
const VARY_ACCEPT = /Accept/iu;
const ABOUT_HEADING = /^# John Solly/mu;

export const productionUrl = "https://www.jsolly.com";

export async function smoke({ page, context, verifyHttp }) {
	await page
		.getByRole("heading", { name: "Hi, I'm John Solly.", exact: true })
		.waitFor();
	await page.setViewportSize({ width: 390, height: 844 });
	const toggle = page.getByRole("button", { name: "Toggle mobile menu" });
	const menu = page.getByRole("navigation", { name: "Mobile navigation" });
	await toggle.waitFor();
	assert.equal(
		await toggle.getAttribute("aria-expanded"),
		"false",
		"mobile menu starts closed",
	);
	await toggle.click();
	await menu.waitFor({ state: "visible" });
	assert.equal(
		await toggle.getAttribute("aria-expanded"),
		"true",
		"mobile menu announces expansion",
	);
	await menu
		.getByRole("link", { name: "About John Solly", exact: true })
		.click();
	await page.waitForURL(`${productionUrl}/about/`);
	await page
		.getByRole("heading", { name: "John Solly", exact: true })
		.waitFor();
	await verifyHttp(page.url());
	await page.getByRole("button", { name: "Toggle mobile menu" }).click();
	await page
		.getByRole("navigation", { name: "Mobile navigation" })
		.getByRole("link", { name: "Contact John Solly", exact: true })
		.click();
	await page.waitForURL(`${productionUrl}/contact/`);
	assert.match(
		await page.locator("h1").textContent(),
		CONTACT_HEADING,
		"contact page renders after mobile navigation",
	);
	await verifyHttp(page.url());
	const markdown = await context.request.get(`${productionUrl}/about/`, {
		headers: { accept: "text/markdown" },
	});
	assert.equal(markdown.status(), 200, "Markdown negotiation succeeds");
	assert.match(markdown.headers()["content-type"] ?? "", MARKDOWN_TYPE);
	assert.match(markdown.headers().vary ?? "", VARY_ACCEPT);
	assert.match(await markdown.text(), ABOUT_HEADING);
}
