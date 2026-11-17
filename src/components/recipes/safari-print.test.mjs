import assert from "node:assert/strict";
import { it } from "vitest";
import { readRecipeURL } from "./recipe-url.mjs";
import { needsSafariPrint, safariPrintLinks } from "./safari-print.mjs";

const recipe = {
	id: "greek-turkey-patties",
	familyOptions: [{ id: "pita_one" }],
};

it("only installed iOS and iPadOS apps need the Safari print handoff", () => {
	const iphone = {
		userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X)",
		standalone: true,
	};
	assert.equal(needsSafariPrint(iphone, false), true);
	assert.equal(needsSafariPrint({ ...iphone, standalone: false }, true), true);
	assert.equal(
		needsSafariPrint({ ...iphone, standalone: false }, false),
		false,
	);
	assert.equal(
		needsSafariPrint({ userAgent: "iPad", standalone: true }, false),
		true,
	);
	assert.equal(
		needsSafariPrint(
			{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
			true,
		),
		true,
	);
	assert.equal(
		needsSafariPrint(
			{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 },
			true,
		),
		false,
	);
	assert.equal(
		needsSafariPrint({ userAgent: "Android", standalone: true }, true),
		false,
	);
});

it("Safari and copyable links preserve recipe settings on the current Preview origin", () => {
	for (const units of ["us", "grams", "metric"]) {
		for (const servings of [2, 4, 6, 8]) {
			const settings = {
				servings,
				units,
				familyDiners: Math.min(2, servings),
				familyChoice: { [recipe.id]: "pita_one" },
			};
			const links = safariPrintLinks(
				recipe,
				settings,
				"https://preview.example.test",
			);
			const restored = readRecipeURL(new URL(links.url), [recipe]);
			assert.deepEqual(restored, { ...settings, recipeId: recipe.id });
			assert.equal(new URL(links.url).origin, "https://preview.example.test");
			assert.equal(links.safari, `x-safari-${links.url}`);
		}
	}
});

it("local HTTP testing retains a copyable link without offering an invalid Safari scheme", () => {
	const links = safariPrintLinks(
		recipe,
		{ servings: 6, units: "metric" },
		"http://localhost:4321",
	);
	assert.equal(links.safari, "");
	assert.equal(
		links.url,
		// biome-ignore lint/security/noSecrets: public recipe URL fixture.
		"http://localhost:4321/recipes/greek-turkey-patties/?servings=6&units=metric&starch=",
	);
});
