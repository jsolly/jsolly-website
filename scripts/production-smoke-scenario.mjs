// biome-ignore-all lint/suspicious/noMisplacedAssertion: This exported scenario is executed by the production smoke runner.
import assert from "node:assert/strict";

const CONTACT_HEADING = /Contact/iu;

export const productionUrl = "https://www.jsolly.com";

export async function smoke({ page }) {
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
}
