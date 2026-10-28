// Exercise old shared URLs and saved preferences without reintroducing the removed
// ingredient-units selector. All equivalent ingredient amounts remain visible.
export async function setLegacyUnits(page, units) {
	await page.evaluate((value) => {
		const key = "recipes-settings-v1";
		let saved;
		try {
			saved = JSON.parse(localStorage.getItem(key)) || {};
		} catch {
			saved = {};
		}
		localStorage.setItem(key, JSON.stringify({ ...saved, units: value }));
	}, units);
	const url = new URL(page.url());
	url.searchParams.set("units", units);
	await page.goto(url.href);
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
}

export function legacyUnits(page) {
	return page.evaluate(() => {
		const explicit = new URL(location.href).searchParams.get("units");
		return (
			explicit ||
			JSON.parse(localStorage.getItem("recipes-settings-v1") || "{}").units ||
			"us"
		);
	});
}
