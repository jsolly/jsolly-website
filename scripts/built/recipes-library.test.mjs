import assert from "node:assert/strict";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import {
	DEFAULT_FILTERS,
	defaultAppliances,
	PRINT_FAILED,
	STORAGE_KEY,
} from "../../src/components/recipes/constants.mjs";
import { matchesRecipe } from "../../src/components/recipes/nutrient-filters.mjs";
import recipeData from "../../src/components/recipes/recipe-data.server.mjs";
import { collectErrors, serveStatic } from "./pages.mjs";
import { assertPrintImage } from "./recipe-print-image.mjs";

// The hydrated recipe library in Chromium: printing from the recipe dialog
// and the collection, the dialog's place in the browser history, and the
// saved settings (J13: localStorage recipes-settings-v1) when they no longer
// fit the collection, hold a family side, or are not valid at all.
const DIST = "dist";

const { recipes } = recipeData;
const smoothies = recipes.filter((recipe) => recipe.type === "smoothie");
const meals = recipes.filter((recipe) => recipe.type === "meal");
const FAMILY_SIDE = /^Add a side/u;
const SERVINGS = /^Servings/u;
const PITA = "pita_one";
const SHAWARMA = "shawarma-chicken-bowls";

let site;
let browser;

before(async () => {
	site = await serveStatic(DIST);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await site?.close();
});

// A fresh 1280px context; `initScript` runs before the page's own scripts.
// Resolves to { page, errors, close }.
async function openPage({ initScript, arg } = {}) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		reducedMotion: "reduce",
	});
	if (initScript) await context.addInitScript(initScript, arg);
	const page = await context.newPage();
	const errors = collectErrors(page);
	return { page, errors, close: () => context.close() };
}

async function goHydrated(page, path) {
	await page.goto(`${site.origin}${path}`);
	await page.locator("[data-hydrated=true]").waitFor();
	await page.waitForFunction(
		() =>
			document.querySelector("#meal-results").getAttribute("aria-busy") ===
			"false",
	);
}

// The titles of the recipes in the library's print copy.
const printedTitles = (page) =>
	page
		.locator(".print-output .print-meal")
		.evaluateAll((articles) =>
			articles.map((article) => article.getAttribute("aria-label")),
		);

// Prints by firing beforeprint, as a browser's print dialog does.
function printFiresBeforePrint() {
	window.print = () => {
		window.dispatchEvent(new Event("beforeprint"));
		document.documentElement.setAttribute("data-test-print-requested", "true");
	};
}

function printFails() {
	window.print = () => {
		throw new Error("printing blocked");
	};
}

it("single-recipe printing loads its detail while browser-menu printing keeps only loaded cards", {
	timeout: 60_000,
}, async () => {
	const { page, errors, close } = await openPage({
		initScript: printFiresBeforePrint,
	});
	const failing = await openPage({ initScript: printFails });
	const packs = [];
	page.on("request", (request) => {
		if (request.url().includes("/recipes/data/packs/"))
			packs.push(request.url());
	});
	try {
		const shawarma = recipes.find((recipe) => recipe.id === SHAWARMA);
		await goHydrated(page, `/recipes/#${shawarma.id}`);
		assert.deepEqual(
			await printedTitles(page),
			[],
			"no hidden print packet while browsing",
		);
		const takeover = page.locator(".recipe-takeover");
		await takeover.waitFor();
		await takeover.getByRole("button", { name: "Print recipe" }).click();
		await page
			.locator("[data-test-print-requested=true]")
			.waitFor({ state: "attached" });
		await page.emulateMedia({ media: "print" });
		assert.deepEqual(await printedTitles(page), [shawarma.title]);
		assert.equal(await page.locator(".print-output").isVisible(), true);
		assert.equal(await takeover.isHidden(), true);
		await assertPrintImage(page.locator(".print-output .recipe-photo img"));
		await page.emulateMedia({ media: "screen" });
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		assert.equal(
			await page.locator(".meal-library").getAttribute("data-print-prepared"),
			"false",
		);
		assert.equal(
			await page.evaluate(() =>
				document.documentElement.getAttribute("data-recipe-print"),
			),
			null,
		);
		assert.deepEqual(await printedTitles(page), []);
		await page.keyboard.press("Escape");
		await takeover.waitFor({ state: "detached" });
		const ids = () =>
			page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId));
		const loaded = await ids();
		assert.equal(loaded.length, 6);
		const requestsBeforeMenu = packs.length;
		await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
		await page.emulateMedia({ media: "print" });
		assert.deepEqual(await ids(), loaded);
		assert.equal(await page.locator(".recipe-grid").isVisible(), true);
		assert.equal(
			await page.locator(".recipe-card:visible").count(),
			loaded.length,
		);
		assert.deepEqual(
			await printedTitles(page),
			[],
			"browser-menu printing does not download full recipes",
		);
		assert.equal(packs.length, requestsBeforeMenu);
		assert.equal(
			await page
				.getByRole("button", { name: "Print all meals", includeHidden: true })
				.count(),
			0,
		);
		await page.emulateMedia({ media: "screen" });
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await goHydrated(page, "/recipes/smoothies/");
		const smoothieIds = await ids();
		await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
		await page.emulateMedia({ media: "print" });
		assert.deepEqual(await ids(), smoothieIds);
		assert.equal(
			await page.locator(".recipe-card:visible").count(),
			smoothies.length,
		);
		assert.deepEqual(await printedTitles(page), []);
		assert.equal(
			await page
				.getByRole("button", {
					name: "Print all smoothies",
					includeHidden: true,
				})
				.count(),
			0,
		);

		await goHydrated(failing.page, "/recipes/meals/");
		await failing.page
			.locator(".recipe-card")
			.first()
			.getByRole("button", { name: "Print recipe", exact: true })
			.click();
		await failing.page
			.locator(".action-status")
			.filter({ hasText: PRINT_FAILED })
			.waitFor();
		assert.equal(
			await failing.page.evaluate(() =>
				document.documentElement.getAttribute("data-recipe-print"),
			),
			null,
		);
		assert.deepEqual(await printedTitles(failing.page), []);
		assert.deepEqual(errors, []);
		assert.deepEqual(
			failing.errors.map((error) => error.split("\n")[0]),
			["Recipe printing failed: Error: printing blocked"],
		);
	} finally {
		await close();
		await failing.close();
	}
});

it("the recipe dialog follows the browser history: Back to recipes returns to its card, Back reopens it, Back again closes it, and a new #<recipe-id> swaps the recipe", {
	timeout: 60_000,
}, async () => {
	const { page, errors, close } = await openPage();
	const section = (id) => page.locator(`.recipe-takeover section#${id}`);
	const takeover = page.locator(".recipe-takeover");
	const setHash = (hash) =>
		page.evaluate((value) => {
			window.location.hash = value;
		}, hash);
	try {
		await goHydrated(page, "/recipes/");
		await page.evaluate(() => {
			window.__sameDocument = true;
		});
		await setHash("#strawberry-banana-smoothie");
		await section("strawberry-banana-smoothie").waitFor();
		await page.getByRole("button", { name: "← Back to recipes" }).click();
		await takeover.waitFor({ state: "detached" });
		const back = await page.evaluate(() => ({
			hash: window.location.hash,
			focused: document.activeElement?.matches(
				'a.title-button[data-recipe-id="strawberry-banana-smoothie"]',
			),
		}));
		await page.goBack();
		await section("strawberry-banana-smoothie").waitFor();
		const reopenedHash = await page.evaluate(() => window.location.hash);
		await page.goBack();
		await takeover.waitFor({ state: "detached" });
		const closedHash = await page.evaluate(() => window.location.hash);
		await setHash("#avocado-lime-smoothie");
		await section("avocado-lime-smoothie").waitFor();
		await setHash("#banana-flax-smoothie");
		await section("banana-flax-smoothie").waitFor();
		assert.deepEqual(
			{
				back,
				reopenedHash,
				closedHash,
				shown: await takeover
					.locator("section.recipe-detail")
					.evaluateAll((sections) => sections.map((element) => element.id)),
				sameDocument: await page.evaluate(() => window.__sameDocument),
				errors,
			},
			{
				back: { hash: "#meal-results", focused: true },
				reopenedHash: "#strawberry-banana-smoothie",
				closedHash: "",
				shown: ["banana-flax-smoothie"],
				sameDocument: true,
				errors: [],
			},
		);
	} finally {
		await close();
	}
});

it("saved filters that no smoothie meets are cleared on the smoothies page, so its cards still show", {
	timeout: 60_000,
}, async () => {
	// The nutrition filters that apply to smoothies, in every combination:
	// at least one must leave no smoothie, or this test proves nothing.
	const combinations = [false, true].flatMap((immune) =>
		[false, true].map((omega) => ({ immune, omega })),
	);
	const unmet = combinations.find(
		(flags) =>
			!smoothies.some((recipe) =>
				matchesRecipe(recipe, 4, {
					...flags,
					appliances: defaultAppliances,
				}),
			),
	);
	assert.ok(unmet, "some nutrition filter combination matches no smoothie");
	const { page, errors, close } = await openPage({
		initScript: ([key, saved]) => {
			if (!sessionStorage.getItem("seeded")) {
				localStorage.setItem(key, JSON.stringify(saved));
				sessionStorage.setItem("seeded", "1");
			}
		},
		arg: [
			STORAGE_KEY,
			{
				servings: 4,
				filters: {
					immuneSupport: unmet.immune,
					omega3: unmet.omega,
					ingredientChoice: ["hemp"],
				},
			},
		],
	});
	try {
		await goHydrated(page, "/recipes/smoothies/");
		const saved = await page.evaluate(
			(key) => JSON.parse(localStorage.getItem(key)),
			STORAGE_KEY,
		);
		assert.deepEqual(
			{
				cards: Number(
					await page.locator("#meal-results").getAttribute("data-match-count"),
				),
				filters: saved.filters,
				errors,
			},
			{ cards: smoothies.length, filters: DEFAULT_FILTERS, errors: [] },
		);
	} finally {
		await close();
	}
});

it("a family side picked in the recipe dialog is still picked after a reload", {
	timeout: 60_000,
}, async () => {
	const { page, errors, close } = await openPage();
	try {
		await goHydrated(page, "/recipes/#shawarma-chicken-bowls");
		const side = () =>
			page
				.locator(".recipe-takeover")
				.getByRole("combobox", { name: FAMILY_SIDE });
		await side().selectOption(PITA);
		await page.reload();
		await page.locator("[data-hydrated=true]").waitFor();
		await page.locator(".recipe-takeover").waitFor();
		assert.deepEqual(
			{ side: await side().inputValue(), errors },
			{ side: PITA, errors: [] },
		);
	} finally {
		await close();
	}
});

it("unreadable or wrongly shaped saved settings leave the library on its defaults, without a page error", {
	timeout: 60_000,
}, async () => {
	const results = [];
	for (const saved of [
		"{not json",
		JSON.stringify({
			servings: "lots",
			filters: {
				proteinChoice: "fish",
				mealKetoOnly: ["keto"],
				vegetarianOnly: "true",
				starchChoice: { rice: true },
				ironRich: "yes",
			},
			appliancesOnHand: null,
			familyChoice: "pita",
		}),
	]) {
		// biome-ignore lint/performance/noAwaitInLoops: one fresh browser context per saved value, in turn
		const { page, errors, close } = await openPage({
			initScript: ([key, value]) => {
				if (!sessionStorage.getItem("seeded")) {
					localStorage.setItem(key, value);
					sessionStorage.setItem("seeded", "1");
				}
			},
			arg: [STORAGE_KEY, saved],
		});
		try {
			await goHydrated(page, "/recipes/meals/");
			assert.deepEqual(
				errors,
				saved === "{not json"
					? [
							"Recipe settings could not be restored; using defaults. SyntaxError",
						]
					: [],
			);
			results.push({
				cards: Number(
					await page.locator("#meal-results").getAttribute("data-match-count"),
				),
				servings: await page
					.getByRole("combobox", { name: SERVINGS })
					.inputValue(),
				resaved: await page.evaluate(
					(key) => JSON.parse(localStorage.getItem(key)),
					STORAGE_KEY,
				),
			});
		} finally {
			await close();
		}
	}
	const defaults = {
		cards: meals.length,
		servings: "4",
		resaved: {
			servings: 4,
			units: "us",
			filters: DEFAULT_FILTERS,
			appliancesOnHand: defaultAppliances,
			familyChoice: {},
		},
	};
	assert.deepEqual(results, [defaults, defaults]);
});

for (const operation of ["getItem", "setItem"]) {
	it(`a failed settings ${operation} is logged without saved data and cooking controls remain usable`, async () => {
		const { page, errors, close } = await openPage({
			initScript: (method) => {
				Storage.prototype[method] = () => {
					throw new DOMException("private saved data", "SecurityError");
				};
			},
			arg: operation,
		});
		try {
			await goHydrated(page, "/recipes/meals/");
			const servings = page.getByRole("combobox", { name: SERVINGS });
			assert.equal(await servings.inputValue(), "4");
			await servings.selectOption("6");
			assert.equal(await servings.inputValue(), "6");
			assert.ok((await page.locator(".recipe-card").count()) > 0);
			assert.ok(
				errors.some((text) =>
					text.includes(
						operation === "getItem"
							? "could not be restored"
							: "could not be saved",
					),
				),
			);
			assert.ok(
				errors.every(
					(text) =>
						text.endsWith("SecurityError") &&
						!text.includes("private saved data"),
				),
			);
		} finally {
			await close();
		}
	});
}

it("a saved optional side its recipe no longer offers defaults to none everywhere", {
	timeout: 60_000,
}, async () => {
	const { page, errors, close } = await openPage({
		initScript: ([key, saved]) => {
			if (!sessionStorage.getItem("seeded")) {
				localStorage.setItem(key, JSON.stringify(saved));
				sessionStorage.setItem("seeded", "1");
			}
		},
		arg: [STORAGE_KEY, { familyChoice: { [SHAWARMA]: "naan" } }],
	});
	try {
		await goHydrated(page, `/recipes/#${SHAWARMA}`);
		const takeover = page.locator(".recipe-takeover");
		await takeover.waitFor();
		const cardHref = await page
			.locator(`a.title-button[data-recipe-id="${SHAWARMA}"]`)
			.getAttribute("href");
		assert.deepEqual(
			{
				side: await takeover
					.getByRole("combobox", { name: FAMILY_SIDE })
					.inputValue(),
				sideShown: await takeover.locator(".family-box p").count(),
				cardStarch: new URL(cardHref, site.origin).searchParams.get("starch"),
				errors,
			},
			{ side: "", sideShown: 0, cardStarch: null, errors: [] },
		);
	} finally {
		await close();
	}
});

it("Share recipe in the library dialog shares its servings and family side, and the card links carry them after it closes", {
	timeout: 60_000,
}, async () => {
	const { page, errors, close } = await openPage({
		initScript: () => {
			Object.defineProperty(navigator, "share", {
				configurable: true,
				value: (data) => {
					window.sharedRecipe = data;
					return Promise.resolve();
				},
			});
		},
	});
	try {
		await goHydrated(page, `/recipes/?servings=8#${SHAWARMA}`);
		const takeover = page.locator(".recipe-takeover");
		await takeover.waitFor();
		await takeover
			.getByRole("combobox", { name: FAMILY_SIDE })
			.selectOption(PITA);
		await takeover.getByRole("button", { name: "Share this recipe" }).click();
		const shared = new URL(await page.evaluate(() => window.sharedRecipe.url));
		await page.keyboard.press("Escape");
		await takeover.waitFor({ state: "detached" });
		const card = new URL(
			await page
				.locator(`a.title-button[data-recipe-id="${SHAWARMA}"]`)
				.getAttribute("href"),
			site.origin,
		);
		const query = (url) => ({
			path: url.pathname,
			servings: url.searchParams.get("servings"),
			starch: url.searchParams.get("starch"),
		});
		const expected = {
			path: `/recipes/${SHAWARMA}/`,
			servings: "8",
			starch: `${SHAWARMA}:${PITA}`,
		};
		assert.deepEqual(
			{ shared: query(shared), card: query(card), errors },
			{ shared: expected, card: expected, errors: [] },
		);
	} finally {
		await close();
	}
});

it("a cross-collection hash opens one recipe, browser-menu printing prepares it, and Back restores its collection and focus", {
	timeout: 30_000,
}, async () => {
	const { page, errors, close } = await openPage();
	const recipe = smoothies.find(
		(entry) => entry.id === "strawberry-banana-smoothie",
	);
	try {
		await goHydrated(page, `/recipes/meals/#${recipe.id}`);
		const takeover = page.locator(".recipe-takeover");
		await takeover.waitFor();
		assert.deepEqual(await printedTitles(page), []);
		const atSnapshot = await page.evaluate(() => {
			window.dispatchEvent(new Event("beforeprint"));
			return [...document.querySelectorAll(".print-output .print-meal")].map(
				(article) => article.getAttribute("aria-label"),
			);
		});
		assert.deepEqual(
			atSnapshot,
			[recipe.title],
			"browser-menu printing can synchronously prepare the already-open recipe",
		);
		await page.emulateMedia({ media: "print" });
		assert.equal(await page.locator(".print-output").isVisible(), true);
		assert.equal(await takeover.isHidden(), true);
		await page.emulateMedia({ media: "screen" });
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await takeover.getByRole("button", { name: "← Back to recipes" }).click();
		await takeover.waitFor({ state: "detached" });
		await page.waitForFunction(
			() =>
				document.querySelector("#meal-results").getAttribute("aria-busy") ===
				"false",
		);
		assert.deepEqual(
			await page
				.locator(".recipe-card .title-button")
				.evaluateAll((links) => links.map((link) => link.dataset.recipeId)),
			smoothies.map((entry) => entry.id),
		);
		assert.equal(
			await page
				.locator(`[data-recipe-id="${recipe.id}"]`)
				.evaluate((link) => link === document.activeElement),
			true,
		);
		assert.deepEqual(await printedTitles(page), []);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});
