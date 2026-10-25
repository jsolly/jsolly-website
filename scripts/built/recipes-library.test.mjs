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

// The hydrated recipe library in Chromium: printing from a card and the
// collection, and the saved settings (J13: localStorage recipes-settings-v1)
// when they no longer fit the collection, hold a family side (picked on a
// recipe page, which shares the record), or are not valid at all.
const DIST = "dist";

const { recipes } = recipeData;
const smoothies = recipes.filter((recipe) => recipe.type === "smoothie");
const meals = recipes.filter((recipe) => recipe.type === "meal");
const FAMILY_SIDE = /^Add a side/u;
const SIDE_DINERS = "People having this side";
const SERVINGS = /^Servings/u;
const PROTEINS = /^Proteins:/u;
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
async function openPage({ initScript, arg, serviceWorkers = "allow" } = {}) {
	const context = await browser.newContext({
		serviceWorkers,
		viewport: { width: 1280, height: 900 },
		reducedMotion: "reduce",
	});
	if (initScript) await context.addInitScript(initScript, arg);
	const page = await context.newPage();
	const errors = collectErrors(page);
	return { page, errors, close: () => context.close() };
}

// Opens a recipe page and waits for its saved and URL settings.
async function goRecipe(page, path) {
	await page.goto(`${site.origin}${path}`);
	await page.waitForFunction(
		() => !document.querySelector("astro-island[ssr]"),
	);
	await page.locator(".recipe-page[data-preferences-ready=true]").waitFor();
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

it("card printing loads only that recipe's detail while browser-menu printing keeps only loaded cards", {
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
		await goHydrated(page, "/recipes/");
		assert.deepEqual(
			await printedTitles(page),
			[],
			"no hidden print packet while browsing",
		);
		// The first card, so printing scrolls nothing and loads no more cards.
		const first = page.locator(".recipe-card").first();
		const firstId = await first
			.locator(".title-button")
			.getAttribute("data-recipe-id");
		await first
			.getByRole("button", { name: "Print recipe", exact: true })
			.click();
		await page
			.locator("[data-test-print-requested=true]")
			.waitFor({ state: "attached" });
		await page.emulateMedia({ media: "print" });
		assert.deepEqual(await printedTitles(page), [
			recipes.find((recipe) => recipe.id === firstId).title,
		]);
		assert.deepEqual(
			packs.map((url) => new URL(url).pathname),
			[`/recipes/data/packs/${firstId}.json`],
			"card printing downloads only that recipe's pack",
		);
		assert.equal(await page.locator(".print-output").isVisible(), true);
		assert.equal(await page.locator(".recipe-grid").isVisible(), false);
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

it("a family side picked on a recipe page is saved with the library's settings, kept after a reload or a units change and carried by its card link", {
	timeout: 60_000,
}, async () => {
	const { page, errors, close } = await openPage({
		initScript: ([key, saved]) => {
			if (!sessionStorage.getItem("seeded")) {
				localStorage.setItem(key, JSON.stringify(saved));
				sessionStorage.setItem("seeded", "1");
			}
		},
		arg: [STORAGE_KEY, { servings: 6, familyChoice: { other: "rice" } }],
	});
	const side = () => page.getByRole("combobox", { name: FAMILY_SIDE });
	try {
		await goRecipe(page, `/recipes/${SHAWARMA}/`);
		assert.equal(await side().inputValue(), "");
		await side().selectOption(PITA);
		await page.getByRole("combobox", { name: SIDE_DINERS }).selectOption("2");
		const picked = {
			starch: new URL(page.url()).searchParams.get("starch"),
			sideDiners: new URL(page.url()).searchParams.get("sideDiners"),
			saved: await page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key)),
				STORAGE_KEY,
			),
		};
		await page.reload();
		await page.locator(".recipe-page[data-preferences-ready=true]").waitFor();
		const reloaded = await side().inputValue();
		// A plain link uses the saved side; a link carrying settings decides it.
		await goRecipe(page, `/recipes/${SHAWARMA}/`);
		const plain = await side().inputValue();
		// A units change then reload keeps the saved side.
		await page
			.getByRole("combobox", { name: "Ingredient units" })
			.selectOption("grams");
		await page.reload();
		await page.locator(".recipe-page[data-preferences-ready=true]").waitFor();
		const query = new URL(page.url()).searchParams;
		const afterUnits = {
			side: await side().inputValue(),
			units: query.get("units"),
			starch: query.get("starch"),
			sideDiners: query.get("sideDiners"),
		};
		await goRecipe(page, `/recipes/${SHAWARMA}/?servings=4&units=us`);
		const explicit = await side().inputValue();
		await goHydrated(page, "/recipes/");
		const card = new URL(
			await page
				.locator(`a.title-button[data-recipe-id="${SHAWARMA}"]`)
				.getAttribute("href"),
			site.origin,
		);
		assert.deepEqual(
			{
				picked,
				reloaded,
				plain,
				afterUnits,
				explicit,
				cardStarch: card.searchParams.get("starch"),
				cardSideDiners: card.searchParams.get("sideDiners"),
				errors,
			},
			{
				picked: {
					starch: `${SHAWARMA}:${PITA}`,
					sideDiners: "2",
					saved: {
						servings: 6,
						units: "us",
						familyDiners: 2,
						familyChoice: { other: "rice", [SHAWARMA]: PITA },
					},
				},
				reloaded: PITA,
				plain: PITA,
				afterUnits: {
					side: PITA,
					units: "grams",
					starch: `${SHAWARMA}:${PITA}`,
					sideDiners: "2",
				},
				explicit: "",
				cardStarch: `${SHAWARMA}:${PITA}`,
				cardSideDiners: "2",
				errors: [],
			},
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
			familyDiners: 0,
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
		await goRecipe(page, `/recipes/${SHAWARMA}/`);
		const detail = page.locator(".recipe-detail");
		const onPage = {
			side: await detail
				.getByRole("combobox", { name: FAMILY_SIDE })
				.inputValue(),
			sideShown: await detail.locator(".family-box p").count(),
		};
		await goHydrated(page, "/recipes/");
		const cardHref = await page
			.locator(`a.title-button[data-recipe-id="${SHAWARMA}"]`)
			.getAttribute("href");
		assert.deepEqual(
			{
				...onPage,
				cardStarch: new URL(cardHref, site.origin).searchParams.get("starch"),
				errors,
			},
			{ side: "", sideShown: 0, cardStarch: null, errors: [] },
		);
	} finally {
		await close();
	}
});

it("Share recipe on a recipe page shares its servings and family side, and the library card links carry them", {
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
		await goRecipe(page, `/recipes/${SHAWARMA}/?servings=8`);
		await page.getByRole("combobox", { name: FAMILY_SIDE }).selectOption(PITA);
		await page.getByRole("combobox", { name: SIDE_DINERS }).selectOption("2");
		await page.getByRole("button", { name: "Share this recipe" }).click();
		const shared = new URL(await page.evaluate(() => window.sharedRecipe.url));
		await goHydrated(page, "/recipes/?servings=8");
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
			sideDiners: url.searchParams.get("sideDiners"),
		});
		const expected = {
			path: `/recipes/${SHAWARMA}/`,
			servings: "8",
			starch: `${SHAWARMA}:${PITA}`,
			sideDiners: "2",
		};
		assert.deepEqual(
			{ shared: query(shared), card: query(card), errors },
			{ shared: expected, card: expected, errors: [] },
		);
	} finally {
		await close();
	}
});

it("a reader who marks a recipe made sees the date on its page and, in another open tab, on its library card, can mark it made again later, and can clear it", async () => {
	const { page, errors, close } = await openPage();
	try {
		await page.clock.setFixedTime(new Date(2026, 9, 24, 12));
		await goHydrated(page, "/recipes/meals/");
		const id = await page
			.locator(".recipe-card a.title-button")
			.first()
			.getAttribute("data-recipe-id");
		assert.ok(
			meals.some((recipe) => recipe.id === id),
			id,
		);
		const badges = page.locator(".made-badge");
		assert.equal(await badges.count(), 0);

		// The recipe opens in a second tab while the library stays open.
		const tab = await page.context().newPage();
		const tabErrors = collectErrors(tab);
		await tab.clock.setFixedTime(new Date(2026, 9, 24, 12));
		await goRecipe(tab, `/recipes/${id}/`);
		const made = tab.getByRole("checkbox", { name: "I made this" });
		const again = tab.getByRole("button", { name: "Made it today" });
		assert.equal(await made.isChecked(), false);
		await made.check();
		const stored = () =>
			tab.evaluate(
				(key) => JSON.parse(localStorage.getItem(key) || "null"),
				"recipes-made-v1",
			);
		await badges.waitFor();
		assert.deepEqual(
			{
				date: await tab.locator(".made-date").textContent(),
				again: await again.count(),
				stored: await stored(),
				badges: await badges.allTextContents(),
				badgeCard: await page
					.locator(".recipe-card")
					.filter({ has: page.locator(`a[data-recipe-id="${id}"]`) })
					.locator(".made-badge")
					.count(),
			},
			{
				date: "Last made Oct 24, 2026",
				again: 0,
				stored: { [id]: "2026-10-24" },
				badges: ["Made it!"],
				badgeCard: 1,
			},
		);
		await tab.emulateMedia({ media: "print" });
		assert.equal(await tab.locator(".made").isVisible(), false);
		await tab.emulateMedia({ media: "screen" });

		// Six days later, returning to the open page offers "Made it today"
		// without a reload, and the mark survives one.
		await tab.clock.setFixedTime(new Date(2026, 9, 30, 12));
		await tab.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		await again.waitFor();
		await tab.reload();
		await tab.locator(".recipe-page[data-preferences-ready=true]").waitFor();
		assert.equal(await made.isChecked(), true);
		await again.focus();
		await tab.keyboard.press("Enter");
		const status = tab.locator(".made [role=status]");
		const confirmed = status.filter({
			hasText: "Marked made today, Oct 30, 2026.",
		});
		await confirmed.waitFor();
		// Returning to the tab the same day keeps the confirmation.
		await tab.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		assert.deepEqual(
			{
				status: await status.textContent(),
				date: await tab.locator(".made-date").textContent(),
				again: await again.count(),
				focusedOnMade: await made.evaluate(
					(box) => box === document.activeElement,
				),
				stored: await stored(),
			},
			{
				status: "Marked made today, Oct 30, 2026.",
				date: "Last made Oct 30, 2026",
				again: 0,
				focusedOnMade: true,
				stored: { [id]: "2026-10-30" },
			},
		);
		assert.deepEqual(await badges.allTextContents(), ["Made it!"]);

		// When the library tab saves an earlier date, the recipe tab drops the
		// confirmation that no longer describes its mark.
		await page.evaluate(
			([key, saved]) => localStorage.setItem(key, JSON.stringify(saved)),
			["recipes-made-v1", { [id]: "2026-10-24" }],
		);
		await again.waitFor();
		assert.deepEqual(
			{
				status: await status.textContent(),
				checked: await made.isChecked(),
				date: await tab.locator(".made-date").textContent(),
			},
			{ status: "", checked: true, date: "Last made Oct 24, 2026" },
		);
		await again.click();
		await confirmed.waitFor();

		await made.uncheck();
		await badges.waitFor({ state: "detached" });
		assert.deepEqual(
			{
				status: await status.textContent(),
				date: await tab.locator(".made-date").count(),
				stored: await stored(),
				errors: [...errors, ...tabErrors],
			},
			{ status: "", date: 0, stored: {}, errors: [] },
		);
	} finally {
		await close();
	}
});

it("chips under the results heading show the active filters and search, remove one at a time keeping focus, and Clear all leaves appliances alone", async () => {
	const { page, errors, close } = await openPage();
	try {
		await goHydrated(page, "/recipes/meals/");
		const chips = page.locator(".active-filters li button");
		assert.equal(await chips.count(), 0);
		const ovenBefore = await page
			.getByRole("checkbox", { name: "Oven" })
			.isChecked();
		await page.getByRole("checkbox", { name: "Oven" }).uncheck();

		await page.getByRole("button", { name: PROTEINS }).click();
		await page
			.getByRole("dialog", { name: "Proteins choices" })
			.getByRole("checkbox", { name: "Chicken", exact: true })
			.check();
		await page.keyboard.press("Escape");
		await page.getByRole("checkbox", { name: "Dump and go" }).check();
		await page
			.getByRole("searchbox", { name: "Search recipes" })
			.fill("garlic");
		await page
			.getByRole("button", { name: "Remove search: “garlic”" })
			.waitFor();
		assert.deepEqual(
			{
				list: await page
					.getByRole("list", { name: "Active filters and search" })
					.count(),
				chips: await chips.allTextContents(),
				names: await chips.evaluateAll((buttons) =>
					buttons.map((button) => button.getAttribute("aria-label")),
				),
			},
			{
				list: 1,
				chips: ["Chicken", "Dump and go", "“garlic”"],
				names: [
					"Remove filter: Chicken",
					"Remove filter: Dump and go",
					"Remove search: “garlic”",
				],
			},
		);

		await chips.first().click();
		assert.deepEqual(
			{
				chips: await chips.allTextContents(),
				focused: await page.evaluate(() =>
					document.activeElement?.getAttribute("aria-label"),
				),
				proteins: await page
					.getByRole("button", { name: PROTEINS })
					.getAttribute("aria-label"),
			},
			{
				chips: ["Dump and go", "“garlic”"],
				focused: "Remove filter: Dump and go",
				proteins: "Proteins: All proteins",
			},
		);
		const focusedName = () =>
			page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
		// Removing the last chip focuses the new last one; removing the only one
		// returns focus to the results heading.
		await chips.last().click();
		assert.deepEqual(
			{ chips: await chips.allTextContents(), focused: await focusedName() },
			{ chips: ["Dump and go"], focused: "Remove filter: Dump and go" },
		);
		await chips.first().click();
		assert.deepEqual(
			{
				chips: await chips.count(),
				focused: await page.evaluate(() => document.activeElement?.textContent),
			},
			{ chips: 0, focused: "Find your meal" },
		);

		await page.getByRole("checkbox", { name: "Dump and go" }).check();
		await page
			.getByRole("searchbox", { name: "Search recipes" })
			.fill("garlic");
		await page
			.getByRole("button", { name: "Remove search: “garlic”" })
			.waitFor();
		await page.getByRole("button", { name: "Clear all" }).click();
		assert.deepEqual(
			{
				chips: await chips.count(),
				dumpAndGo: await page
					.getByRole("checkbox", { name: "Dump and go" })
					.isChecked(),
				search: await page
					.getByRole("searchbox", { name: "Search recipes" })
					.inputValue(),
				oven: await page.getByRole("checkbox", { name: "Oven" }).isChecked(),
				focused: await page.evaluate(() => document.activeElement?.textContent),
				errors,
			},
			{
				chips: 0,
				dumpAndGo: false,
				search: "",
				oven: false,
				focused: "Find your meal",
				errors: [],
			},
		);
		assert.equal(ovenBefore, true);
	} finally {
		await close();
	}
});
