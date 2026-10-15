// Recipe library constants shared by the recipe modules, their tests and
// scripts/recipes.

/** Recipe ingredient amounts and timings are written for this many adults. */
export const BASE_SERVINGS = 4;
/** Each recipe group's badge on its page. */
export const groupBadges = {
	keto: "Keto",
	shared: "Shared main",
	nonketo: "Not Keto",
	unverified: null,
};
/** Each recipe group's label in the printed copy. */
export const printGroupLabels = {
	keto: "Keto",
	shared: "Keto main + family starch",
	nonketo: "Not Keto",
	unverified: "Nutrition estimated",
};
/** The servings a reader can choose. */
export const SERVING_CHOICES = [2, 4, 6, 8];

export const recipeDisclaimer =
	"These recipes include household adaptations and recipes adapted from the linked publishers. The adaptations have not been kitchen-tested. Nutrition provenance and source limitations are listed with each recipe; missing nutrition stays unreported.";
// Meal leftovers guidance; smoothies carry their own.
export const mealLeftovers =
	"Refrigerate in shallow containers within two hours, or one hour above 90°F. Use within 3–4 days or freeze; reheat to 165°F. Keep cold greens and yogurt separate.";

// Main starches and available family sides; vegetable carbs are not starch categories.
export const starchTypes = {
	all: "All starches",
	rice: "Rice",
	pasta: "Pasta",
	bread: "Bread",
	tortillas: "Tortillas",
	potatoes: "Potatoes",
	legumes: "Legumes",
	none: "No starch",
	fruit: "Fruit",
};
export const applianceChoices = {
	"Instant Pot": "Pressure cookers",
	Oven: "Oven",
	Pans: "Pans",
	Microwave: "Microwave",
	"Two air fryers": "Air fryers",
	Blender: "Blender",
	Stovetop: "Stovetop",
	Grill: "Grill",
	"Slow cooker": "Slow cooker",
	"Waffle iron": "Waffle iron",
};
export const defaultAppliances = {
	"Instant Pot": 1,
	Oven: 1,
	Pans: 1,
	Microwave: 1,
	"Two air fryers": 2,
	Blender: 1,
	Stovetop: 1,
	Grill: 1,
	"Slow cooker": 1,
	"Waffle iron": 1,
};
// The appliances a reader counts rather than ticks, with the most they can
// have on hand; every other appliance is on hand (1) or not (0).
export const applianceLimits = { "Instant Pot": 2, "Two air fryers": 2 };
// How many of an appliance a recipe that needs it uses (otherwise one).
export const applianceNeeds = { "Two air fryers": 2 };
// Pans may be used on a stovetop, grill or oven; recipes name their heat source.

/** The recipe library's landing page; the recipe app's id, start URL and scope. */
export const RECIPES_PATH = "/recipes/";
/** The recipe app's service worker, which scripts/recipes/pwa-build.mjs writes. */
export const PWA_WORKER_PATH = "/recipes/service-worker.js";
/** The recipe app's manifest and icons. */
export const PWA_FILES_PATH = "/recipes/pwa/";
/**
 * The recipe app's name on a home screen and its theme colour, in the
 * RecipeLayout head tags; public/recipes/pwa/manifest.webmanifest repeats
 * them (scripts/unit/recipe-data.test.mjs checks they agree).
 */
export const PWA_NAME = "Easy Meals";
export const PWA_THEME_COLOR = "#183e2b";

/** localStorage key for the library's saved settings (merge-plan J13). */
export const STORAGE_KEY = "recipes-settings-v1";
export const PRINT_FAILED =
	"Printing could not open. Use your browser’s Print command.";
/** The library's protein filter choices. */
export const proteins = {
	chicken: "Chicken",
	fish: "Fish",
	turkey: "Turkey",
	beef: "Beef",
	pork: "Pork",
	shrimp: "Shrimp",
	seafood: "Other seafood",
	eggs: "Eggs",
	mixed: "Mixed meats",
};
/** The library's meal styles (recipe groups). */
export const carbStyles = {
	keto: "Keto",
	nonketo: "Not Keto",
	shared: "Shared Main",
	unverified: "Nutrition estimated",
};
export const dietaryPreferences = { ...carbStyles, vegetarian: "Vegetarian" };
export const mealStyleDescriptions = {
	vegetarian: "Meals without meat or fish; eggs and dairy may be included.",
	all: "Keto meals, higher-carb meals, and shared mains with different sides.",
	keto: "Low-carb meals without a starchy side.",
	nonketo: "Meals with over 50g net carbs per four servings.",
	shared: "One main dish with different sides for keto and non-keto diners.",
	unverified:
		"Nutrition uses documented ingredient estimates; keto eligibility has not been verified.",
};
/** The family starches a library filter offers ("all" and "none" are not choices). */
export const starchOptions = Object.fromEntries(
	Object.entries(starchTypes).filter(([key]) => !["all", "none"].includes(key)),
);
/**
 * The library's filters before a reader picks any: proteins, starches and
 * smoothie ingredients (arrays of ids), one meal style ("all" or a
 * carbStyles key), and the keto-smoothie and nutrition checks.
 */
export const DEFAULT_FILTERS = {
	proteinChoice: [],
	starchChoice: [],
	ingredientChoice: [],
	mealStyle: "all",
	smoothieKetoOnly: false,
	immuneSupport: false,
	ironRich: false,
	omega3: false,
};
/** Each nutrition filter's threshold, as the nutrition help states it. */
export const nutritionThresholds = {
	ironRich: "at least 20% Daily Value of iron per serving.",
	immuneSupport:
		"at least 20% Daily Value in two or more of vitamins A, C, D, zinc and selenium per serving.",
	omega3:
		"at least 0.5 g of recorded ALA, EPA, and DHA per meal serving or 8 oz smoothie glass. Missing nutrient observations are excluded. This is a recipe filter threshold, not a Daily Value.",
};

/** Shared labels and explanations for nutrition filters and recipe highlights. */
export const nutritionHighlights = {
	immune: {
		label: "Immune support",
		description: nutritionThresholds.immuneSupport,
	},
	iron: { label: "Iron-rich", description: nutritionThresholds.ironRich },
	omega: { label: "High in Omega-3s", description: nutritionThresholds.omega3 },
};
