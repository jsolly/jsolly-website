// Explicit cooking-amount edits for the complete measurement migration.
// Applying this file again preserves recipe data and makes no further changes.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const original = readFileSync(path, "utf8");
const data = JSON.parse(original);
const recipes = new Map(data.recipes.map((recipe) => [recipe.id, recipe]));

function replaceText(value, replacements) {
	if (typeof value === "string") {
		let text = value;
		for (const [before, after] of replacements)
			text = text.replaceAll(before, after);
		return text;
	}
	if (Array.isArray(value))
		return value.map((item) => replaceText(item, replacements));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				replaceText(item, replacements),
			]),
		);
	return value;
}

function migrate(id, replacements) {
	const recipe = recipes.get(id);
	if (!recipe)
		throw new Error(`Missing cooking-quantity migration recipe: ${id}`);
	for (const field of ["steps", "timeline", "flow", "tips"])
		if (recipe[field]) recipe[field] = replaceText(recipe[field], replacements);
	for (const ingredient of [...recipe.ingredients, ...recipe.familyOptions])
		ingredient.note = replaceText(ingredient.note, replacements);
}

for (const id of ["greek-turkey-patties", "pan-fried-greek-turkey-patties"])
	migrate(id, [
		["25 g", "{{mass:25}}"],
		["50 g", "{{mass:50}}"],
		["100 g", "{{mass:100}}"],
	]);
migrate("lemon-salmon-and-asparagus", [["170 g (6 oz)", "{{mass:170}}"]]);
migrate("pesto-cod-and-zucchini", [["170 g (6 oz)", "{{mass:170}}"]]);
migrate("sheet-pan-chicken-fajitas", [
	["totaling about 50 g", "totaling about {{mass:50}}"],
]);
migrate("source-perfect-roast-chicken", [
	// biome-ignore lint/security/noSecrets: Exact gram quantities for the source's four-to-five-pound bird range.
	["4–5-pound", "{{mass:1814.36948}}–{{mass:2267.96185}}"],
]);
migrate("source-steak-and-eggs-keto-low-carb", [
	["6-ounce", "{{mass:170.09713875}}"],
]);
migrate("source-creamy-fajita-chicken-breasts-skillet", [
	[
		"For the original four-portion batch, measure 1 tsp from the fajita packet for chicken; scale this measured share with portions and reserve the remaining scaled seasoning for vegetables. Season chicken with that measured share.",
		"Measure {{portion:ingredient-6:tsp:1}} fajita seasoning for the chicken; reserve the rest for the vegetables. Season chicken with that share.",
	],
	["1 tsp per four servings", "{{portion:ingredient-6:tsp:1}}"],
	[
		"1 tsp fajita seasoning per four servings",
		"{{portion:ingredient-6:tsp:1}} fajita seasoning",
	],
]);

// Source parentheticals remain in measurementProvenance.original, not beside a scaled quantity.
for (const recipe of data.recipes)
	for (const ingredient of recipe.ingredients) {
		ingredient.note = ingredient.note
			.replace(/Base four-serving batch: about one 10 oz can\.\s*/gu, "")
			.replace(
				/Base four-serving batch: one 15 oz can; do not substitute dry beans\./gu,
				"Do not substitute dry beans.",
			)
			.replace(/^Source also (?:provides|gives approximately) [^.]*\.\s*/u, "")
			.replace(
				/^Source specifies \d+\/\d+–\d+\/\d+ cup(?:, to preference)?[.;]\s*/u,
				"",
			);
	}

function patchIngredient(recipeId, ingredientId, patch) {
	const recipe = recipes.get(recipeId);
	const ingredient = [...recipe.ingredients, ...recipe.familyOptions].find(
		(item) => item.id === ingredientId,
	);
	if (!ingredient)
		throw new Error(
			`Missing cooking-quantity cleanup ingredient: ${recipeId}/${ingredientId}`,
		);
	Object.assign(ingredient, patch);
}
patchIngredient("pesto-cod-and-zucchini", "basil_pesto", {
	note: "Substitute at most 2 g net carbs per 30 g.",
});
patchIngredient("spinach-feta-and-hemp-frittata", "olive_oil", {
	note: "One quarter for the dish; three quarters for the salad.",
});
for (const recipeId of [
	"shawarma-chicken-bowls",
	"salsa-verde-shredded-chicken",
])
	patchIngredient(recipeId, "rice_half_cup", {
		note: "Heat ready-cooked rice.",
	});
for (const recipeId of [
	"shawarma-chicken-bowls",
	"greek-turkey-patties",
	"pan-fried-greek-turkey-patties",
])
	migrate(recipeId, [
		["60 g pita", "{{mass:60}} pita"],
		["45 g ready-to-eat bun", "{{mass:45}} ready-to-eat bun"],
	]);
patchIngredient("source-keto-jalapen-o-chicken", "ingredient-1", { state: "" });
patchIngredient("source-chicken-taco-casserole", "ingredient-3", { note: "" });
patchIngredient(
	"source-cajun-chicken-sausage-and-cabbage-skillet",
	"ingredient-2",
	{ state: "chopped into bite sized pieces" },
);
patchIngredient(
	"source-cajun-chicken-sausage-and-cabbage-skillet",
	"ingredient-4",
	{ state: "sliced" },
);
patchIngredient("source-cheesy-sausage-soup", "ingredient-3", {
	state: "finely chopped",
});
patchIngredient(
	"source-keto-parmesan-tilapia-and-asparagus-for-one",
	"ingredient-2",
	{ state: "woody ends removed" },
);
patchIngredient("source-keto-crack-chicken-slow-cooker", "ingredient-13", {
	note: "",
	state: "",
});
patchIngredient(
	"source-garlic-butter-chicken-bites-with-lemon-asparagus",
	"ingredient-3",
	{
		note: "{{quantity:ingredient-3:0.5}} for browning the chicken and {{quantity:ingredient-3:0.5}} for the sauce",
	},
);
patchIngredient(
	"source-garlic-butter-shrimp-with-lemon-parmesan-cauliflower-rice",
	"ingredient-6",
	{ note: "One-third to cauliflower and two-thirds to shrimp." },
);
patchIngredient("source-perfect-roast-chicken", "ingredient-1", {
	name: "Whole chicken",
});
patchIngredient(
	"source-garlic-butter-chicken-bites-with-zucchini-noodles",
	"ingredient-13",
	{ note: "For less heat, use less; for more heat, add gradually to taste." },
);
patchIngredient(
	"source-cheesy-garlic-burgers-with-lemon-butter-zucchini-noodles",
	"ingredient-9",
	{ note: "Half to burgers and half to sauce." },
);
for (const id of [
	"ingredient-11",
	"ingredient-12",
	"ingredient-13",
	"ingredient-14",
	"ingredient-15",
])
	patchIngredient(
		"source-paprika-chicken-thighs-with-lemon-zucchini-skillet",
		id,
		{
			note:
				id === "ingredient-15"
					? "For less heat, use less; for more heat, add gradually to taste."
					: "",
		},
	);
patchIngredient("source-cabbage-with-sausage-foil-packs", "ingredient-6", {
	state: "cut into {{mass:7.1}} butter slices",
});
patchIngredient(
	"source-garlic-butter-chicken-bites-with-lemon-asparagus",
	"ingredient-5",
	{
		note: "{{quantity:ingredient-5:0.5}} for the chicken bites and {{quantity:ingredient-5:0.5}} for the asparagus and sauce",
	},
);
// Retain existing heat adjustment directions when removing import commentary.
for (const recipe of data.recipes)
	for (const ingredient of recipe.ingredients) {
		const guidance = ingredient.measurementProvenance.original.note.match(
			/(?:For less heat,|Use fewer chili flakes for less heat).*$/u,
		)?.[0];
		if (guidance && !ingredient.note.includes(guidance))
			ingredient.note = [ingredient.note, guidance].filter(Boolean).join(" ");
	}
for (const recipe of data.recipes)
	for (const ingredient of recipe.ingredients)
		ingredient.state = ingredient.state
			.replace(
				/(?:source uses )?one [\d.]+-ounce (?:package|container|carton)/giu,
				"",
			)
			.replace(/; source package weight and link count are missing/gu, "")
			.replace(" (required by method, preparation unspecified by source)", "")
			.replace(/^[;,\s]+|[;,\s]+$/gu, "");
const posole = recipes.get("chicken-posole");
posole.tips = posole.tips.map((tip) =>
	tip.replace("The original 3g cayenne is hot", "Cayenne is hot"),
);

// Prepared-store substitutions keep the same edible mass, independent of package size.
for (const id of [
	"source-chicken-burrito-bowls-with-cauliflower",
	"source-beef-and-cauliflower-rice-burrito-bowl",
])
	patchIngredient(id, "ingredient-4", {
		note: "",
		alternatives: [
			{
				name: "Riced cauliflower",
				amount: 588,
				unit: "g",
				weightRef: "usda-169986",
				measurementProvenance: {
					reviewedOn: "2026-10-15",
					massBasis: "edible",
					decision:
						"Replace the unspecified packet with the primary medium head's 588 g edible target; no package yield is assumed.",
				},
			},
		],
	});
patchIngredient(
	"source-10-minute-pizza-zucchini-noodles-with-marinara-sauce-pepperoni",
	"ingredient-2",
	{
		state: "spiralized",
		alternatives: [
			{
				name: "Packaged spiralized zucchini",
				amount: 784,
				unit: "g",
				weightRef: "usda-169291",
				measurementProvenance: {
					reviewedOn: "2026-10-15",
					massBasis: "edible",
					decision:
						"Use the same edible target as four reviewed 196 g medium zucchini; unspecified grocery packages are purchased to this mass.",
				},
			},
		],
	},
);
patchIngredient(
	"source-sausage-taco-cauliflower-rice-skillet",
	"ingredient-7",
	{
		state: "steamed",
		note: "",
		alternatives: [
			{
				name: "Fresh cauliflower, riced and steamed",
				amount: 453.59237,
				unit: "g",
				measurementProvenance: {
					reviewedOn: "2026-10-15",
					massBasis: "edible",
					decision:
						"Use the same normalized four-serving 16-ounce prepared edible target as the packaged cauliflower. Rice and steam fresh florets before measuring this target; no raw-to-cooked yield is assumed.",
				},
			},
		],
	},
);
for (const [recipeId, ingredientId, patch] of [
	["source-keto-jalapen-o-chicken", "ingredient-8", { state: "" }],
	["source-keto-cheeseburger-casserole-skillet", "ingredient-3", { state: "" }],
	[
		"source-greek-chicken-marinade-sheet-pan-dinner",
		"ingredient-5",
		{ state: "" },
	],
	[
		"source-grilled-salmon-kabobs-with-greek-marinade",
		"ingredient-8",
		{ state: "" },
	],
	[
		"source-cowboy-butter-chicken-with-zucchini-noodles-15-minute",
		"ingredient-4",
		{ note: "" },
	],
	["source-sheet-pan-shrimp-fajitas", "ingredient-5", { note: "" }],
	[
		"source-creamy-chicken-with-bacon-and-spinach",
		"ingredient-11",
		{ state: "", note: "" },
	],
])
	patchIngredient(recipeId, ingredientId, patch);
for (const recipe of data.recipes)
	for (const ingredient of recipe.ingredients) {
		ingredient.state = ingredient.state
			.replace(/; source range [^;]+ chosen/gu, "")
			.replace(/; source says two large breasts per pound/gu, "")
			.trim();
		ingredient.note = ingredient.note
			.replace(
				/Fraction of a 32-ounce package; the package size is preserved from the publisher\.\s*/gu,
				"",
			)
			.replace(
				/Two-thirds of the source four-ounce can at four servings\.\s*/gu,
				"",
			)
			.replace(
				/Source specifies one 14-ounce can\. The listed ounces are undrained package contents, not drained solids: weigh the displayed share before draining\.\s*/gu,
				"",
			)
			.replace(
				/Optional; excluded or included as stated in the publisher nutrition\.\s*/gu,
				"",
			)
			.replace(
				/(?:Vegetable stock is an explicit source alternative|Ghee is the source alternative|Uses its explicit weight basis)\.\s*/gu,
				"",
			)
			.replace(
				/The ingredient list omits a weight; this adaptation uses the publisher’s stated \{\{mass:170\.09713875\}\} steak per nutrition portion\.\s*/gu,
				"",
			)
			.trim();
	}

for (const [recipeId, state] of [
	[
		"source-garlic-butter-steak-bites-with-lemon-zucchini-noodles",
		"medium, spiralized",
	],
	[
		"source-lemon-garlic-butter-chicken-and-zucchini-noodles-skillet",
		"spiralized",
	],
	[
		"source-taco-chicken-tenders-with-lemon-garlic-butter-zucchini-noodles",
		"rinsed and spiralized",
	],
])
	patchIngredient(recipeId, "ingredient-2", {
		state,
		note: "",
		alternatives: [
			{
				name: "Packaged zucchini noodles",
				amount: 784,
				unit: "g",
				weightRef: "usda-169291",
				measurementProvenance: {
					reviewedOn: "2026-10-15",
					massBasis: "edible",
					decision:
						"Replace an unspecified store-bought pack with the same edible target as four reviewed 196 g medium zucchini.",
				},
			},
		],
	});
patchIngredient("source-low-carb-taco-casserole", "ingredient-4", {
	state: "undrained",
});
patchIngredient(
	"source-cilantro-lime-shrimp-and-cauliflower-rice-keto-low-carb",
	"ingredient-5",
	{ state: "frozen" },
);
patchIngredient("source-italian-sausage-and-peppers-skillet", "ingredient-1", {
	state: "",
});

// Reviewed cooking-copy cleanup: keep source quantities in provenance, not scaled cooking rows.
for (const [recipeId, ingredientId, patch] of [
	[
		"spinach-feta-and-hemp-frittata",
		"salad_greens",
		{
			note: "",
		},
	],
	[
		"shawarma-chicken-bowls",
		"salad_greens",
		{
			note: "",
		},
	],
	[
		"sheet-pan-chicken-fajitas",
		"bell_pepper",
		{
			note: "",
		},
	],
	[
		"sheet-pan-chicken-fajitas",
		"onion",
		{
			note: "",
		},
	],
	[
		"sheet-pan-chicken-fajitas",
		"salad_greens",
		{
			note: "",
		},
	],
	[
		"greek-turkey-patties",
		"salad_greens",
		{
			note: "",
		},
	],
	[
		"harissa-chickpea-and-cauliflower-bowls",
		"mild_harissa",
		{
			note: "Half for roasting and half for yogurt. Hot concentrated pastes are not equivalent. Use less harissa for less heat or a little more for more heat; add gradually.",
		},
	],
	[
		"harissa-chickpea-and-cauliflower-bowls",
		"salad_greens",
		{
			note: "",
		},
	],
	[
		"sheet-pan-gnocchi-white-beans-and-broccoli",
		"cherry_tomatoes",
		{
			note: "",
		},
	],
	[
		"pan-fried-greek-turkey-patties",
		"salad_greens",
		{
			note: "",
		},
	],
	[
		"chicken-posole",
		"red_pepper",
		{
			note: "",
		},
	],
	[
		"chicken-posole",
		"enchilada_sauce",
		{
			note: "Use Old El Paso medium red sauce. Choose a mild version for less heat or a hot version for more heat; keep the measured amount.",
		},
	],
	[
		"chicken-posole",
		"cooked_chicken_breast",
		{
			note: "",
		},
	],
	[
		"chicken-posole",
		"cabbage",
		{
			note: "For garnish.",
		},
	],
	[
		"chicken-posole",
		"cilantro",
		{
			note: "For garnish.",
		},
	],
	[
		"source-skillet-creamy-lemon-chicken-with-cauliflower",
		"ingredient-11",
		{
			state: "",
		},
	],
	[
		"source-creamy-buffalo-chicken-cauliflower-casserole",
		"ingredient-2",
		{
			state: "riced or finely chopped",
		},
	],
	[
		"source-greek-chicken-marinade-sheet-pan-dinner",
		"ingredient-6",
		{
			note: "",
		},
	],
	[
		"source-cheesy-chicken-zucchini-boats-recipe",
		"ingredient-3",
		{
			state: "cooked and chopped",
		},
	],
	[
		"source-bacon-wrapped-chicken-with-avocado-salsa",
		"ingredient-2",
		{
			note: "Use fewer bacon slices for small breasts.",
		},
	],
	[
		"source-bacon-wrapped-chicken-with-avocado-salsa",
		"ingredient-9",
		{
			note: "Add more to taste.",
		},
	],
	[
		"source-cabbage-casserole-with-ground-beef",
		"ingredient-3",
		{
			note: "",
		},
	],
	[
		"source-steak-rolls",
		"ingredient-2",
		{
			note: "",
		},
	],
	[
		"source-the-best-keto-chili-recipe",
		"ingredient-12",
		{
			note: "",
		},
	],
	[
		"source-the-best-keto-chili-recipe",
		"ingredient-13",
		{
			note: "",
		},
	],
	[
		"source-keto-italian-meatballs",
		"ingredient-5",
		{
			note: "Use pork-rind panko for the keto recipe; breadcrumb choice changes gluten allergens.",
		},
	],
	[
		"source-low-carb-taco-casserole",
		"ingredient-3",
		{
			note: "",
		},
	],
	[
		"source-cabbage-with-sausage-foil-packs",
		"ingredient-2",
		{
			note: "",
		},
	],
	[
		"source-keto-sausage-veggie-sheet-pan-dinner",
		"ingredient-3",
		{
			state: "cut into chunks",
		},
	],
	[
		"source-sheet-pan-butter-dill-salmon-with-asparagus",
		"ingredient-2",
		{
			state: "individual fillets about {{mass:170.09713875}} each",
		},
	],
	[
		"source-cilantro-lime-shrimp-and-cauliflower-rice-keto-low-carb",
		"ingredient-6",
		{
			state: "finely grated zest",
		},
	],
	[
		"source-cilantro-lime-shrimp-and-cauliflower-rice-keto-low-carb",
		"ingredient-7",
		{
			state: "freshly squeezed",
		},
	],
	[
		"source-cilantro-lime-shrimp-and-cauliflower-rice-keto-low-carb",
		"ingredient-18",
		{
			state: "finely grated zest",
		},
	],
	[
		"source-cilantro-lime-shrimp-and-cauliflower-rice-keto-low-carb",
		"ingredient-19",
		{
			state: "freshly squeezed",
		},
	],
	[
		"source-one-pan-shrimp-and-asparagus",
		"ingredient-2",
		{
			note: "",
		},
	],
	[
		"source-blackened-shrimp-and-asparagus-skillet-20-minutes",
		"ingredient-11",
		{
			note: "",
		},
	],
	[
		"source-lemon-garlic-steak-and-broccoli-skillet",
		"ingredient-8",
		{
			note: "Use the parsley in the sauce.",
		},
	],
	[
		"source-one-pan-sausage-veggies",
		"ingredient-1",
		{
			note: "Choose fully cooked smoked sausage.",
		},
	],
	[
		"source-garlic-butter-shrimp-and-broccoli-skillet",
		"ingredient-2",
		{
			note: "",
		},
	],
	[
		"source-garlic-butter-cod-with-lemon-asparagus-skillet",
		"ingredient-1",
		{
			state: "medium; cut each fillet into 3 or 4 chunks",
		},
	],
	[
		"source-creamy-cajun-shrimp-with-sausage",
		"ingredient-2",
		{
			note: "Choose fully cooked pork or chicken sausage.",
		},
	],
	[
		"source-garlic-butter-chicken-with-cauliflower-rice",
		"ingredient-1",
		{
			state: "large, halved horizontally",
		},
	],
	[
		"source-garlic-butter-salmon-with-lemon-asparagus",
		"ingredient-1",
		{
			state: "medium; cut each fillet into 3 or 4 chunks",
		},
	],
	[
		"source-lemon-garlic-butter-salmon-with-zucchini-noodles",
		"ingredient-1",
		{
			state: "cut each fillet into 3 or 4 chunks",
		},
	],
	[
		"source-cheesy-turkey-meatballs-with-cauliflower-rice",
		"ingredient-10",
		{
			note: "",
		},
	],
	[
		"source-tomato-spinach-chicken-skillet-low-carb-keto",
		"ingredient-1",
		{
			note: "",
		},
	],
	[
		"source-paprika-chicken-thighs-with-lemon-zucchini-skillet",
		"ingredient-7",
		{
			note: "",
		},
	],
	[
		"source-garlic-butter-sausages-and-broccoli-skillet",
		"ingredient-6",
		{
			note: "Lemon slices for garnish.",
		},
	],
	[
		"source-garlic-butter-pork-with-lemon-asparagus",
		"ingredient-9",
		{
			note: "",
		},
	],
	[
		"source-lemon-garlic-butter-chicken-and-zucchini-noodles-skillet",
		"ingredient-9",
		{
			note: "Lemon slices for garnish.",
		},
	],
	[
		"source-10-minute-sheet-pan-steak-with-lemon-zucchini",
		"ingredient-8",
		{
			note: "",
		},
	],
	[
		"source-lemon-garlic-butter-chicken-tenders-recipe",
		"ingredient-9",
		{
			note: "Lemon slices for garnish.",
		},
	],
	[
		"source-chicken-burrito-bowls-with-cauliflower",
		"ingredient-4",
		{
			name: "Medium cauliflower head",
		},
	],
	[
		"source-garlic-butter-turkey-meatballs-with-zucchini-noodles",
		"ingredient-13",
		{
			note: "",
		},
	],
	[
		"source-garlic-butter-sausages-with-lemon-green-beans",
		"ingredient-6",
		{
			note: "Lemon slices for garnish.",
		},
	],
	[
		"source-buttery-garlic-herb-chicken-and-lemon-parmesan-cauliflower-rice",
		"ingredient-6",
		{
			state: "riced",
		},
	],
	[
		"source-buttery-garlic-herb-chicken-and-lemon-parmesan-cauliflower-rice",
		"ingredient-13",
		{
			note: "Add zest and lemon slices for garnish.",
		},
	],
	[
		"source-buttery-garlic-herb-chicken-and-lemon-parmesan-cauliflower-rice",
		"ingredient-18",
		{
			note: "For the marinade.",
		},
	],
	[
		"source-garlic-butter-steak-and-green-beans",
		"ingredient-6",
		{
			note: "Lemon slices for garnish.",
		},
	],
	[
		"source-taco-chicken-tenders-with-lemon-garlic-butter-zucchini-noodles",
		"ingredient-1",
		{
			state: "boneless, skinless, cut into strips",
		},
	],
	[
		"source-taco-chicken-tenders-with-lemon-garlic-butter-zucchini-noodles",
		"ingredient-6",
		{
			note: "",
		},
	],
	[
		"source-one-pan-lemon-butter-chicken-with-asparagus",
		"ingredient-10",
		{
			note: "",
		},
	],
	[
		"source-beef-and-cauliflower-rice-burrito-bowl",
		"ingredient-4",
		{
			name: "Medium cauliflower head",
		},
	],
	[
		"source-sausage-pepper-and-cauliflower-fried-rice",
		"ingredient-1",
		{
			name: "Large cauliflower head",
		},
	],
	[
		"source-sausage-pepper-and-cauliflower-fried-rice",
		"ingredient-9",
		{
			state: "",
		},
	],
	[
		"source-grilled-bruschetta-chicken",
		"ingredient-1",
		{
			state:
				"boneless, skinless; halve each breast horizontally into thin fillets",
		},
	],
])
	patchIngredient(recipeId, ingredientId, patch);

migrate("source-sausage-taco-cauliflower-rice-skillet", [
	[
		"Microwave cauliflower according to packet.",
		"Rice fresh florets, then steam until tender. For packaged rice, microwave according to the packet.",
	],
	[
		"Microwave cauliflower according to its packet.",
		"Rice fresh florets, then steam until tender. For packaged rice, microwave according to the packet.",
	],
	["Microwave cauliflower separately", "Prepare the cauliflower separately"],
]);

const updated = `${JSON.stringify(data, null, "\t")}\n`;
if (updated !== original) writeFileSync(path, updated);
console.log(
	updated === original
		? "Cooking quantity references are current."
		: "Cooking quantity references migrated.",
);
