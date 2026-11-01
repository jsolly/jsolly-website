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

// Observe application-generated links, rather than rereading test setup inputs.
export async function legacyUnits(page) {
	const card = page.locator("a[data-recipe-id]").first();
	if (await card.count())
		return (
			new URL(await card.getAttribute("href"), page.url()).searchParams.get(
				"units",
			) || "us"
		);
	await page.evaluate(() => {
		window.__legacyUnitShare = {
			descriptor: Object.getOwnPropertyDescriptor(navigator, "share"),
			url: "",
		};
		Object.defineProperty(navigator, "share", {
			configurable: true,
			value: ({ url }) => {
				window.__legacyUnitShare.url = url;
				return Promise.resolve();
			},
		});
	});
	try {
		await page
			.getByRole("button", { name: "Share this recipe", exact: true })
			.click();
		const url = await page.evaluate(() => window.__legacyUnitShare.url);
		if (!url)
			throw new Error("Application did not generate a recipe share URL");
		return new URL(url).searchParams.get("units") || "us";
	} finally {
		await page.evaluate(() => {
			const { descriptor } = window.__legacyUnitShare;
			if (descriptor) Object.defineProperty(navigator, "share", descriptor);
			else Reflect.deleteProperty(navigator, "share");
			Reflect.deleteProperty(window, "__legacyUnitShare");
		});
	}
}
