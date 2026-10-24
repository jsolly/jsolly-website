import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { collectErrors, serveStatic } from "./pages.mjs";

// Plan §1.6: blogthedata.com's Easy Meals & Smoothies post now 301s to
// /recipes/, and browsers carry the #fragment across the redirect. The post
// rendered the whole library, so each #<recipe-id> (smoothies included)
// opened that recipe, and #meal-results jumped to the cards. Recipes now render
// only on their own pages, so to accommodate those legacy links a #<recipe-id>
// replaces the library entry with /recipes/<recipe-id>/. Each link is opened
// cold, as a redirect lands it, not as an in-page hash change.
const DIST = "dist";
const LANDING = "/recipes/";
const RECIPES = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const FONT_URL = /\.woff2?$/u;
const COLLECTIONS = { meal: "meals", smoothie: "smoothies" };
const FAMILY_SIDE = /^Add a side/u;

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

const { recipes } = JSON.parse(await readFile(RECIPES, "utf8"));

// Exercise explicit defaults against a different saved side in the meal case.
async function verifySharedNone(page, errors, recipe, landing) {
	await page.evaluate(
		({ id, side }) => {
			localStorage.setItem(
				"recipes-settings-v1",
				JSON.stringify({
					servings: 6,
					units: "metric",
					familyDiners: 2,
					familyChoice: { [id]: side },
				}),
			);
		},
		{ id: recipe.id, side: recipe.familyOptions[0].id },
	);
	await page.goto(
		`${site.origin}${landing}?servings=4&units=us&starch=&sideDiners=0#${recipe.id}`,
		{ waitUntil: "commit" },
	);
	await page.waitForURL((url) => url.pathname === `/recipes/${recipe.id}/`);
	await page.locator("[data-preferences-ready=true]").waitFor();
	const redirected = new URL(page.url()).searchParams;
	await page.reload();
	await page.locator("[data-preferences-ready=true]").waitFor();
	// biome-ignore lint/suspicious/noMisplacedAssertion: Called by the meal's existing legacy-link browser test.
	assert.deepEqual(
		{
			servings: redirected.get("servings"),
			units: redirected.get("units"),
			explicitSide: redirected.has("starch"),
			side: redirected.get("starch"),
			shownSide: await page
				.getByRole("combobox", { name: FAMILY_SIDE })
				.inputValue(),
			shownServings: await page
				.getByRole("combobox", { name: "Servings", exact: true })
				.inputValue(),
			shownUnits: await page
				.getByRole("combobox", { name: "Ingredient units", exact: true })
				.inputValue(),
			sideDinerControls: await page
				.getByRole("combobox", { name: "People having this side", exact: true })
				.count(),
			errors,
		},
		{
			servings: "4",
			units: "us",
			explicitSide: true,
			side: "",
			shownSide: "",
			shownServings: "4",
			shownUnits: "us",
			sideDinerControls: 0,
			errors: [],
		},
	);
}

// The redirect looks the hash up in the library the page already holds, so a
// meal and a smoothie prove the lookup and the collection Back returns to;
// every recipe's own page is checked against its data in recipes-built.test.mjs.
function registerRecipeLink(
	recipe,
	landing = LANDING,
	afterReturn = async () => undefined,
) {
	it(`old ${landing}#${recipe.id} replaces itself with the recipe page, whose Back goes to its collection`, {
		timeout: 30_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 800 },
		});
		const page = await context.newPage();
		const errors = collectErrors(page);
		const recipePage = `${site.origin}/recipes/${recipe.id}/`;
		const collectionPage = `${site.origin}/recipes/${COLLECTIONS[recipe.type]}/`;
		try {
			// An earlier off-library entry: Back through history would leave.
			await page.goto(`${site.origin}/about/`);
			const entries = await page.evaluate(() => history.length);
			await page.goto(`${site.origin}${landing}#${recipe.id}`, {
				waitUntil: "commit",
			});
			await page.waitForURL(recipePage);
			const section = page.locator(`.recipe-page section#${recipe.id}`);
			await section.waitFor();
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			await page.locator("[data-preferences-ready=true]").waitFor();
			assert.equal(
				await section.getByRole("heading", { level: 1 }).textContent(),
				recipe.title,
			);
			const historyLength = await page.evaluate(() => history.length);
			const back = page.getByRole("link", {
				name: `← Back to ${COLLECTIONS[recipe.type]}`,
				exact: true,
			});
			assert.equal(
				await back.getAttribute("href"),
				`/recipes/${COLLECTIONS[recipe.type]}/`,
			);
			// A reload keeps the page's link-following Back.
			await page.reload();
			await page.locator("[data-preferences-ready=true]").waitFor();
			await back.click();
			await page.waitForURL(collectionPage);
			await page.locator("[data-hydrated=true]").waitFor();
			assert.deepEqual(
				{
					historyLength,
					marker: await page.evaluate(() =>
						sessionStorage.getItem("recipes-legacy-redirect"),
					),
					errors,
				},
				// The recipe page replaced the #<recipe-id> entry.
				{ historyLength: entries + 1, marker: null, errors: [] },
			);
			await afterReturn(page, errors, recipe, landing);
		} finally {
			await context.close();
		}
	});
}

for (const type of ["meal", "smoothie"]) {
	registerRecipeLink(
		recipes.find(
			(recipe) =>
				recipe.type === type &&
				(type === "smoothie" || recipe.familyOptions.length > 0),
		),
		LANDING,
		type === "meal" ? verifySharedNone : undefined,
	);
}
// A smoothie linked from the meals collection still lands on the smoothie page,
// and its Back goes to smoothies, not meals.
registerRecipeLink(
	recipes.find((recipe) => recipe.type === "smoothie"),
	"/recipes/meals/",
);

function registerFragmentLink(fontDelay) {
	it(`old /recipes/#meal-results lands on the cards without leaving the library (font delay ${fontDelay}ms)`, {
		timeout: 30_000,
	}, async () => {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 800 },
		});
		const page = await context.newPage();
		const errors = collectErrors(page);
		try {
			if (fontDelay) {
				await page.route(FONT_URL, async (route) => {
					await new Promise((resolve) => setTimeout(resolve, fontDelay));
					await route.continue();
				});
			}
			await page.goto(`${site.origin}${LANDING}#meal-results`);
			await page.locator("[data-hydrated=true]").waitFor();
			const position = await page.evaluate(() => {
				const target = document.querySelector(":target");
				const { top } = target?.getBoundingClientRect() ?? { top: -1 };
				return {
					target: target?.id,
					inView: top >= 0 && top < window.innerHeight,
					path: location.pathname,
				};
			});
			assert.deepEqual(
				position,
				{ target: "meal-results", inView: true, path: LANDING },
				JSON.stringify(
					await page.evaluate(() => ({
						top: document.querySelector(":target")?.getBoundingClientRect().top,
						scrollY: window.scrollY,
						fonts: document.fonts.status,
						scrolling: getComputedStyle(document.documentElement)
							.scrollBehavior,
					})),
				),
			);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
	});
}

for (const fontDelay of [0, 500, 2000]) registerFragmentLink(fontDelay);
