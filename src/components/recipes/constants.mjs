// Recipe library constants shared by the recipe modules, their tests and
// scripts/recipes.

/** Recipe ingredient amounts and timings are written for this many adults. */
export const BASE_SERVINGS = 4;
/** Each recipe group's badge on its page. */
export const groupBadges = {
	keto: "Keto",
	shared: "Shared main",
	nonketo: "Not Keto",
};
/** Each recipe group's label in the printed copy. */
export const printGroupLabels = {
	keto: "Keto",
	shared: "Keto main + family starch",
	nonketo: "Not Keto",
};
/** The servings a reader can choose. */
export const SERVING_CHOICES = [2, 4, 6, 8];

export const recipeDisclaimer =
	"These newly designed recipes have not been cooked, tasted or stopwatch-tested. Nutrition is an ingredient estimate, not laboratory analysis. Sources support safety, labels or comparable methods; they do not validate this exact recipe.";
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
export const recipeStarches = {
	"lemon-salmon-and-asparagus": ["none"],
	"smoky-chicken-thighs-and-broccoli": ["none"],
	"pesto-cod-and-zucchini": ["none"],
	"spinach-feta-and-hemp-frittata": ["none"],
	"shawarma-chicken-bowls": ["rice", "bread"],
	"sheet-pan-chicken-fajitas": ["tortillas"],
	"salsa-verde-shredded-chicken": ["rice"],
	"greek-turkey-patties": ["bread"],
	"pan-fried-greek-turkey-patties": ["bread"],
	"keto-zuppa-toscana": ["none"],
	"avocado-lime-smoothie": ["none"],
	"strawberry-avocado-smoothie": ["fruit"],
	"strawberry-hemp-smoothie": ["fruit"],
	"cucumber-spinach-lime-smoothie": ["none"],
	"strawberry-banana-smoothie": ["fruit"],
	"banana-flax-smoothie": ["fruit"],
	"chicken-posole": ["legumes"],
	"tomato-lentil-and-chicken-bake": ["legumes"],
	"harissa-chickpea-and-cauliflower-bowls": ["legumes"],
	"lemon-chicken-potatoes-and-green-beans": ["potatoes"],
	"sheet-pan-gnocchi-white-beans-and-broccoli": [
		"pasta",
		"potatoes",
		"legumes",
	],
};

export const applianceChoices = {
	"Instant Pot": "Pressure cookers",
	Oven: "Oven",
	Pans: "Pans",
	Microwave: "Microwave",
	"Two air fryers": "Air fryers",
	Blender: "Blender",
};
export const defaultAppliances = {
	"Instant Pot": 1,
	Oven: 1,
	Pans: 1,
	Microwave: 1,
	"Two air fryers": 2,
	Blender: 1,
};
