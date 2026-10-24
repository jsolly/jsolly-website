// Reproduce the reviewed keto collection from the immutable pre-migration registries.
// No lookups, product-label guesses, serving-size changes or live API calls.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ingredientGrams } from "../../src/components/recipes/ingredient-units.mjs";
import { validateFlow } from "../../src/components/recipes/trn-logic.mjs";

const ROOT = new URL("../../", import.meta.url);
const ARCHIVE = "docs/recipes-archive/keto-2026-10-23/";
const DATE = "2026-10-23";
const PURE_SALT = /^(?:fine )?salt$/iu;
const STALE_LIMITATION =
	/nutrition remains unreported|retained as an unquantified|Honey is retained|Sugar is present|Tomatoes-with-chilies can size|can size is missing/iu;
const COOKED_SAUSAGE = /fully cooked|smoked sausage/iu;
const SAUSAGE = /sausag/iu;
const SHRIMP = /shrimp/iu;
const numericLiterals = new WeakMap();
const read = async (path) =>
	JSON.parse(
		await readFile(new URL(path, ROOT), "utf8"),
		function captureNumber(key, value, context) {
			if (typeof value === "number") {
				// biome-ignore lint/nursery/noThisOutsideOfClass: JSON.parse specifies this receiver as the containing object.
				if (!numericLiterals.has(this)) numericLiterals.set(this, new Map());
				// biome-ignore lint/nursery/noThisOutsideOfClass: JSON.parse specifies this receiver as the containing object.
				numericLiterals.get(this).set(key, { value, source: context.source });
			}
			return value;
		},
	);
function retainNumber(key, value) {
	// biome-ignore lint/nursery/noThisOutsideOfClass: JSON.stringify specifies this receiver as the containing object.
	const originalNumber = numericLiterals.get(this)?.get(key);
	return originalNumber && originalNumber.value === value
		? JSON.rawJSON(originalNumber.source)
		: value;
}
const write = async (path, value) =>
	writeFile(
		new URL(path, ROOT),
		`${JSON.stringify(value, retainNumber, "\t")}\n`,
	);
const [data, nutrition, weights, audit, calamari] = await Promise.all([
	read(`${ARCHIVE}recipes.json`),
	read(`${ARCHIVE}nutrition-data.json`),
	read(`${ARCHIVE}ingredient-weights.json`),
	read("docs/plans/keto-recipes-audit.json"),
	read("docs/recipes-sources/keto-fried-calamari.json"),
]);
const references = new Map(
	weights.references.map((reference) => [reference.id, reference]),
);
const decision = new Map(audit.recipes.map((recipe) => [recipe.id, recipe]));
const original = structuredClone(data);
const allRows = [
	...Object.values(nutrition.recipes).flat(),
	...calamari.nutritionRows,
];
const snapshot = ({ name, amount, unit, state }) => ({
	name,
	amount,
	unit,
	state,
});
const grams = (ingredient) =>
	ingredientGrams(
		{
			...ingredient,
			...(ingredient.weightRef
				? { weightReference: references.get(ingredient.weightRef) }
				: {}),
		},
		ingredient.amount,
	);
const setAmount = (recipe, id, value, unit) => {
	const ingredient = recipe.ingredients.find((item) => item.id === id);
	if (!ingredient) throw new Error(`${recipe.id}: no ingredient ${id}`);
	ingredient.amount = value;
	if (unit) ingredient.unit = unit;
};
const remove = (recipe, ids) => {
	const excluded = new Set(ids);
	recipe.ingredients = recipe.ingredients.filter(
		(item) => !excluded.has(item.id),
	);
	const prune = (node) => {
		if (!node.children) return excluded.has(node.ingredientId) ? null : node;
		node.children = node.children.map(prune).filter(Boolean);
		return node.children.length ? node : null;
	};
	recipe.flow.root = prune(recipe.flow.root);
};
const replaceText = (recipe, before, after) => {
	const visit = (value) => {
		if (typeof value === "string") return value.replaceAll(before, after);
		if (Array.isArray(value)) return value.map(visit);
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([key, child]) => [key, visit(child)]),
			);
		return value;
	};
	for (const key of [
		"steps",
		"flow",
		"tips",
		"timeline",
		"limitations",
		"fallback",
	])
		if (recipe[key]) recipe[key] = visit(recipe[key]);
};

function profile(id) {
	const row = allRows.find(
		(item) =>
			item.fdcId === id &&
			["kcal", "protein_g", "carbs_g", "fiber_g"].every((key) =>
				Number.isFinite(item.macros[key]),
			),
	);
	if (!row) throw new Error(`Missing complete reviewed food profile ${id}`);
	return Object.fromEntries(
		[
			"fdcId",
			"description",
			"source",
			"nutrients",
			"macros",
			// biome-ignore lint/security/noSecrets: Existing nutrient field identifier, not a credential.
			"omega3RecordedGramsPer100g",
			"assumedMacroFields",
			"nutrientSources",
		]
			.filter((key) => row[key] !== undefined)
			.map((key) => [key, structuredClone(row[key])]),
	);
}

function recalculate(recipe) {
	const previousRows = nutrition.recipes[recipe.id];
	const rows = recipe.ingredients.map((ingredient) => {
		const row = previousRows.find(
			(item) => item.ingredientId === ingredient.id,
		);
		if (!row)
			throw new Error(`${recipe.id}: missing nutrition row ${ingredient.id}`);
		// Some old combined salt/pepper profiles survived the ingredient split.
		// Pure salt now uses the already observed salt profile, not pepper nutrients.
		if (PURE_SALT.test(ingredient.name) && row.macros.carbs_g > 0) {
			Object.assign(row, profile(173468));
			row.ketoProfileReview =
				"Pure measured salt uses the existing USDA salt profile; pepper remains a separate measured row.";
		}
		const cookingGrams = grams(ingredient);
		const edibleFraction = row.measurementReconciliation?.edibleFraction ?? 1;
		row.grams = cookingGrams * edibleFraction;
		row.ingredientSnapshot = snapshot(ingredient);
		row.measurementReconciliation = {
			edibleFraction,
			basis:
				edibleFraction < 1
					? "retained reviewed edible fraction of purchased cooking mass"
					: "edible cooking mass",
			cookingGrams,
		};
		return row;
	});
	nutrition.recipes[recipe.id] = rows;
	const macros = ["kcal", "protein_g", "carbs_g", "fiber_g"];
	recipe.nutrition = Object.fromEntries(
		macros.map((key) => {
			if (rows.some((row) => !Number.isFinite(row.macros[key])))
				throw new Error(
					`${recipe.id}: unobserved ${key}; adaptation needs a reviewed complete profile`,
				);
			return [
				key,
				rows.reduce(
					(sum, row) => sum + (row.macros[key] * row.grams) / 100,
					0,
				) / 4,
			];
		}),
	);
	const erythritol =
		rows.reduce(
			(sum, row) => sum + ((row.macros.erythritol_g ?? 0) * row.grams) / 100,
			0,
		) / 4;
	if (erythritol > 0) recipe.nutrition.erythritol_g = erythritol;
	recipe.nutrition.net_carbs_g = Math.max(
		0,
		recipe.nutrition.carbs_g - recipe.nutrition.fiber_g - erythritol,
	);
	const prior =
		recipe.sourceRecipe?.nutritionEstimate ?? recipe.nutritionEstimate;
	const estimate = {
		method:
			"Complete sum of the current measured edible ingredient weights times the retained reviewed per-100-g observations. All listed base ingredients are included, with no cooking-retention factors. Optional sides are separate.",
		estimatedMacroFields: [...macros, "net_carbs_g"],
		publisherBaselineFields: [],
		ingredientSnapshot: recipe.ingredients.map((ingredient) => ({
			id: ingredient.id,
			...snapshot(ingredient),
		})),
		assumptions: rows.map(
			(row) =>
				`${recipe.ingredients.find((ingredient) => ingredient.id === row.ingredientId).name}: ${row.description ?? row.food}; ${row.grams} g edible modeled weight. Source ${row.source}.`,
		),
	};
	if (recipe.sourceRecipe) {
		recipe.sourceRecipe.preKetoNutritionEstimate = prior;
		recipe.sourceRecipe.nutritionEstimate = estimate;
		recipe.sourceRecipe.nutritionBasis =
			"Ingredient-based estimates for this keto adaptation, using its measured ingredients and retained reviewed food profiles. Original publisher nutrition is preserved separately.";
	} else recipe.nutritionEstimate = estimate;
	validateFlow(recipe);
	if (recipe.nutrition.net_carbs_g > 12.5)
		throw new Error(
			`${recipe.id}: adaptation still has ${recipe.nutrition.net_carbs_g} g net carbohydrate`,
		);
}

function potatoSide(recipe, originalRecipe) {
	const potato = originalRecipe.ingredients.find(
		(ingredient) => ingredient.id === "baby_potatoes",
	);
	const baseRow = nutrition.recipes[recipe.id].find(
		(row) => row.ingredientId === potato.id,
	);
	const option = {
		id: "plain_roasted_potatoes",
		label: "Plain roasted potatoes",
		amount: potato.amount / 4,
		unit: "g",
		ingredientId: "baby_potatoes",
		ingredientName: "Baby potatoes",
		category: "produce",
		state: "raw, washed; cut into pieces no larger than ¾ inch",
		note: "Roast separately on a lined tray at 425°F until fork-tender, about 30–40 minutes. Start before the chicken; keep potatoes off the shared chicken-and-beans plates until serving. No added oil is included in this side.",
		allergens: [],
		sourceIngredientId: "baby_potatoes",
		measurementProvenance: {
			original: snapshot(potato),
			sourceIngredientId: "baby_potatoes",
			reviewedOn: DATE,
			massBasis: "edible",
			decision:
				"Move one quarter of the original raw potato mass to each explicitly selected side portion; side is roasted separately without added oil.",
		},
	};
	const sideRow = structuredClone(baseRow);
	sideRow.ingredientId = option.id;
	sideRow.grams = option.amount;
	sideRow.ingredientSnapshot = {
		amount: option.amount,
		unit: option.unit,
		state: option.state,
	};
	sideRow.measurementReconciliation = {
		edibleFraction: 1,
		basis: "edible cooking mass",
		cookingGrams: option.amount,
	};
	option.nutrition = Object.fromEntries(
		["kcal", "protein_g", "carbs_g", "fiber_g"].map((key) => [
			key,
			(sideRow.macros[key] * sideRow.grams) / 100,
		]),
	);
	option.nutrition.net_carbs_g =
		option.nutrition.carbs_g - option.nutrition.fiber_g;
	recipe.familyOptions = [option];
	nutrition.familyOptions[recipe.id] = [sideRow];
}

function glazeSide(recipe) {
	const rows = nutrition.recipes[recipe.id];
	const vinegar = rows.find((row) => row.ingredientId === "ingredient-10");
	const sugar = rows.find((row) => row.ingredientId === "ingredient-11");
	const components = [
		{ row: vinegar, fraction: 10 / 11 },
		{ row: sugar, fraction: 1 / 11 },
	];
	const keys = new Set(
		components.flatMap(({ row }) => Object.keys(row.nutrients)),
	);
	const nutrients = Object.fromEntries(
		[...keys]
			.filter((key) =>
				components.every(({ row }) => Number.isFinite(row.nutrients[key])),
			)
			.map((key) => [
				key,
				components.reduce(
					(sum, { row, fraction }) => sum + row.nutrients[key] * fraction,
					0,
				),
			]),
	);
	const macros = Object.fromEntries(
		["kcal", "protein_g", "carbs_g", "fiber_g"].map((key) => [
			key,
			components.reduce(
				(sum, { row, fraction }) => sum + row.macros[key] * fraction,
				0,
			),
		]),
	);
	const option = {
		id: "sweet_balsamic_glaze",
		label: "Sweet balsamic glaze",
		amount: 35,
		unit: "g",
		ingredientId: "sweet_balsamic_glaze",
		ingredientName: "Balsamic vinegar and sugar mixture",
		category: "pantry",
		state:
			"unreduced mixture, 10 parts balsamic vinegar to 1 part sugar by weight",
		note: "Mix ten parts balsamic vinegar with one part sugar by weight, then measure the listed mixture per selected diner. Simmer separately for 5–8 minutes until syrupy. Serve only on individual non-keto plates; the listed amount is before evaporation.",
		allergens: [],
		sourceIngredientId: "sweet_balsamic_glaze",
		measurementProvenance: {
			original: {
				amount: 35,
				unit: "g",
				name: "Balsamic vinegar and sugar mixture",
				state: "unreduced 10:1 mixture",
			},
			sourceIngredientId: "sweet_balsamic_glaze",
			reviewedOn: DATE,
			massBasis: "edible",
			decision:
				"Separate a measured 10:1 vinegar/sugar glaze mixture from the base; calculate the optional portion before simmering loss.",
		},
	};
	const sideRow = {
		ingredientId: option.id,
		food: option.id,
		grams: option.amount,
		source: "https://fdc.nal.usda.gov/download-datasets/",
		description:
			"Reviewed 10:1 balsamic vinegar and sugar mixture, calculated from the existing observed component profiles",
		macros,
		nutrients,
		omega3RecordedGramsPer100g: components.reduce(
			(sum, { row: component, fraction }) =>
				sum + (component.omega3RecordedGramsPer100g ?? 0) * fraction,
			0,
		),
		assumedMacroFields: ["fiber_g"],
		assumption:
			"The original balsamic vinegar profile explicitly assumes unreported fiber is zero; that assumption is retained in the optional mixture.",
		components: components.map(({ row: component, fraction }) => ({
			source: component.source,
			description: component.description,
			fraction,
			macros: component.macros,
			nutrients: component.nutrients,
		})),
		ingredientSnapshot: {
			amount: option.amount,
			unit: option.unit,
			state: option.state,
		},
	};
	option.nutrition = Object.fromEntries(
		Object.entries(macros).map(([key, value]) => [
			key,
			(value * sideRow.grams) / 100,
		]),
	);
	option.nutrition.net_carbs_g =
		option.nutrition.carbs_g - option.nutrition.fiber_g;
	recipe.familyOptions = [option];
	nutrition.familyOptions[recipe.id] = [sideRow];
}

const adjustments = {
	"source-low-carb-taco-casserole": { "ingredient-6": [10, "g"] },
	"source-creamy-chicken-breast-in-spinach-parmesan-sauce": {
		"ingredient-7": [80, "g"],
	},
	"source-creamy-tuscan-salmon-recipe": {
		"ingredient-7": [60, "g"],
		"ingredient-8": [1, "cup"],
		"ingredient-5": [60, "g"],
	},
	"source-creamy-cajun-shrimp-with-sausage": {
		"ingredient-3": [12, "g"],
		"ingredient-7": [25, "g"],
		"ingredient-11": [0.75, "cup"],
	},
	"source-garlic-butter-shrimp-with-lemon-parmesan-cauliflower-rice": {
		"ingredient-9": [25, "g"],
		"ingredient-4": [1, "tsp"],
	},
	"source-lemon-garlic-butter-steak-with-spinach": {
		"ingredient-11": [85, "g"],
		"ingredient-12": [54, "g"],
		"ingredient-13": [19.5, "g"],
	},
	"source-easy-cajun-pork-chops-with-lemon-garlic-zucchini": {
		"ingredient-3": [18, "g"],
	},
	"source-fried-cabbage-with-sausage": {
		"ingredient-3": [25, "g"],
		"ingredient-7": [6, "g"],
		"ingredient-12": [15, "g"],
	},
	"source-italian-sausage-with-cilantro-lime-cauliflower-rice": {
		"ingredient-4": [4, "count"],
		"ingredient-6": [10, "g"],
	},
	"source-sausage-taco-cauliflower-rice-skillet": {
		"ingredient-3": [25, "g"],
		"ingredient-4": [50, "g"],
		"ingredient-5": [6, "g"],
		"ingredient-6": [300, "g"],
		"ingredient-8": [6, "g"],
	},
	"source-one-pan-lemon-butter-chicken-with-asparagus": {
		"ingredient-2": [32, "g"],
		"ingredient-5": [60, "g"],
		"ingredient-11": [1, "count"],
	},
	"source-italian-sausage-and-peppers-skillet": {
		"ingredient-6": [3, "count"],
	},
};

data.recipes = data.recipes.filter(
	(recipe) => decision.get(recipe.id)?.action !== "exclude",
);
for (const recipe of data.recipes) {
	const review = decision.get(recipe.id);
	if (!review) throw new Error(`${recipe.id}: missing planning review`);
	recipe.sharedTable = review.sharedTable
		.replaceAll("adapted ", "")
		.replaceAll("revised ", "")
		.replaceAll(
			"80 g cooked-rice or 60 g pita option",
			"cooked-rice or pita option",
		)
		.replaceAll("80 g cooked-rice option", "cooked-rice option");
	if (review.action !== "adapt") continue;
	const originalRecipe = original.recipes.find((item) => item.id === recipe.id);
	const changes = [];
	for (const [id, [value, unit]] of Object.entries(
		adjustments[recipe.id] ?? {},
	)) {
		const ingredient = recipe.ingredients.find((item) => item.id === id);
		changes.push(
			`${ingredient.name}: ${ingredient.amount} ${ingredient.unit} to ${value} ${unit}; all protein and principal vegetable portions are retained.`,
		);
		setAmount(recipe, id, value, unit);
	}
	if (recipe.id === "lemon-chicken-potatoes-and-green-beans") {
		potatoSide(recipe, originalRecipe);
		remove(recipe, ["baby_potatoes", "water"]);
		for (const id of [
			"olive_oil",
			"dried_oregano",
			"garlic_powder",
			"lemon_zest",
			"black_pepper",
		]) {
			const ingredient = recipe.ingredients.find((item) => item.id === id);
			ingredient.amount /= 2;
		}
		setAmount(recipe, "fine_salt", 0.5, "tsp");
		recipe.title = "Lemon chicken and green beans";
		recipe.summary =
			"Lemon-oregano chicken thighs with green beans; potatoes are a separate optional side.";
		recipe.ingredients.find(
			(ingredient) => ingredient.id === "olive_oil",
		).note = "Divide equally between chicken and green beans.";
		recipe.tips = [
			"Spread the full bean portion in a single layer on its own pan.",
			"Keep the chicken pan and raw-chicken tools separate from the beans.",
			"Optional plain potatoes roast on a separate tray; begin them earlier and check they are fork-tender.",
		];
		recipe.flavorRationale =
			"Lemon, garlic and oregano season the chicken and green beans. Delaying the beans preserves their texture; lemon juice and nutritional yeast finish the meal after roasting.";
		recipe.sharedTable =
			"Serve lemon chicken and green beans to everyone. Roast the optional potatoes on their own tray and add them only to the plates that request them.";
		recipe.image.alt =
			"Illustration of lemon-oregano chicken thighs and roasted green beans.";
		recipe.steps = [
			{
				title: "Prepare",
				text: "Heat the oven to 425°F. Use two half-sheet pans and an instant-read thermometer. Unfold thawed chicken thighs no more than ¾ inch thick, and trim the beans.",
			},
			{
				title: "Season",
				text: "Before handling raw chicken, mix oil, oregano, garlic, lemon zest and pepper in a clean bowl. Divide the mix and salt equally between chicken and beans, using separate bowls and tools.",
			},
			{
				title: "Roast",
				text: "Roast chicken on its own pan for about 20–25 minutes to 165°F. After the first 10 minutes, add the beans on their separate pan and swap racks. Beans need about 10–15 minutes to become tender. Remove each component when ready.",
			},
			{
				title: "Serve",
				text: "Finish with lemon juice and sprinkle nutritional yeast over the beans. Optional potatoes cook separately and can extend elapsed time.",
			},
		];
		const seasoning = (fraction) =>
			[
				"olive_oil",
				"dried_oregano",
				"garlic_powder",
				"lemon_zest",
				"black_pepper",
				"fine_salt",
			].map((ingredientId) => ({ ingredientId, fraction }));
		recipe.flow = {
			prep: [
				"Preheat oven to 425°F. Keep raw-chicken tools separate from the bean preparation. Use two half-sheet pans, with room for a single layer on each.",
				"Unfold thawed thighs no more than ¾ inch thick. Mix seasoning before handling raw chicken and divide the measured mixture equally between chicken and beans.",
				"Start chicken first; add the bean pan after 10 minutes and swap racks. Optional potatoes roast separately and can need an earlier start.",
			],
			root: {
				action:
					"Plate chicken beside green beans; finish with lemon juice and nutritional yeast.",
				children: [
					{
						action:
							"Roast seasoned chicken at 425°F for about 20–25 minutes until the thickest pieces reach 165°F.",
						children: [
							{ ingredientId: "chicken_thigh", fraction: 1 },
							...seasoning(0.5),
						],
					},
					{
						action:
							"Add the separate seasoned bean pan after chicken's first 10 minutes; roast about 10–15 minutes to tenderness and remove when ready.",
						children: [
							{ ingredientId: "green_beans", fraction: 1 },
							...seasoning(0.5),
						],
					},
					{ ingredientId: "lemon_juice", fraction: 1 },
					{ ingredientId: "nutritional_yeast", fraction: 1 },
				],
			},
		};
		recipe.equipment = [
			"Two 18×13-inch half-sheet pans",
			"Oven",
			"Instant-read thermometer",
		];
		recipe.appliancesNeeded = ["Oven", "Pans"];
		recipe.limitations = [
			"Pan capacity, thigh thickness and oven performance can change timing; cooking endpoints control.",
			"Optional potatoes roast separately, without added oil in the modeled side, and can need 30–40 minutes before serving.",
			"This adaptation has not been kitchen-tested. Check packaged ingredients for additional allergens.",
		];
		recipe.timeline = [
			{
				phase: "Prepare",
				duration: "10 min",
				attention: "Season chicken and beans separately.",
			},
			{
				phase: "Roast",
				duration: "20–25 min",
				attention: "Add beans after 10 minutes; check chicken reaches 165°F.",
			},
		];
		recipe.fallback =
			"Use additional oven batches if either pan cannot hold the food in a single layer; allow more elapsed time.";
		recipe.attentionSummary =
			"Add the bean pan after the chicken's first 10 minutes; check chicken and beans separately.";
		changes.push(
			"Move all potatoes to an explicitly selected per-diner side. Remove microwave water from the base. Halve the original oil, herbs and zest, allocating the remaining seasoning equally between chicken and beans; keep all chicken and green beans.",
		);
	}
	if (recipe.id === "source-low-carb-taco-casserole") {
		const ingredient = recipe.ingredients.find(
			(item) => item.id === "ingredient-4",
		);
		ingredient.name = "Canned diced tomatoes";
		Object.assign(
			nutrition.recipes[recipe.id].find(
				(row) => row.ingredientId === ingredient.id,
			),
			profile(170051),
		);
		recipe.flow.prep[0] =
			"Chop jalapeño and cabbage. Use the measured undrained plain diced tomatoes; the jalapeño provides the chili flavor.";
		replaceText(
			recipe,
			"Brown the ground meat in a skillet over medium and drain fat.",
			"Brown the raw ground beef in a skillet over medium until it reaches 160°F, then drain fat.",
		);
		changes.push(
			"Replace canned tomatoes with chilies, whose observed fiber is missing, with the existing complete USDA plain canned-tomato profile at the same 283 g mass; retain the measured jalapeño.",
		);
	}
	if (recipe.id === "source-one-pan-lemon-butter-chicken-with-asparagus") {
		remove(recipe, ["ingredient-6"]);
		replaceText(recipe, ", honey if using", "");
		replaceText(recipe, ", optional honey", "");
		replaceText(
			recipe,
			"lightly coat with coconut flour",
			"apply the thin measured coconut-flour coating",
		);
		recipe.flow.prep.push(
			"Use the measured thin coating and unsweetened lemon-butter sauce; keep any honey as an addition to individual non-keto plates.",
		);
		changes.push(
			"Remove honey from the shared base, halve the coconut-flour coating and reduce lemon juice and lemon slices for a balanced unsweetened sauce. Count all measured flour and butter.",
		);
	}
	if (
		recipe.id === "source-stuffed-chicken-breast-with-mozzarella-and-spinach"
	) {
		remove(recipe, ["ingredient-8"]);
		replaceText(recipe, "Stir in sugar and balsamic", "Stir in balsamic");
		replaceText(
			recipe,
			"then sugar/balsamic/seasoning",
			"then balsamic and seasoning",
		);
		changes.push(
			"Remove added sugar from the tomato sauce; retain chicken and the complete mozzarella-spinach filling.",
		);
	}
	if (recipe.id === "source-grilled-bruschetta-chicken") {
		glazeSide(recipe);
		remove(recipe, ["ingredient-10", "ingredient-11"]);
		recipe.steps = recipe.steps.filter(
			(step) => !step.text.startsWith("If using optional glaze"),
		);
		replaceText(recipe, "and optional glaze", "");
		replaceText(recipe, "and drizzle optional glaze", "");
		recipe.flow.prep[0] =
			"Despite its title, the source method uses a stovetop skillet. The sweet balsamic glaze is a separate optional side for individual non-keto plates.";
		recipe.starches = ["none"];
		changes.push(
			"Remove vinegar and sugar glaze from the base flow. Model an explicitly selected 35 g unreduced 10:1 vinegar/sugar mixture per side diner, simmered and served separately.",
		);
	}
	if (recipe.id === "source-creamy-chicken-breast-in-spinach-parmesan-sauce") {
		replaceText(recipe, ", using a little reserved tomato oil if needed", "");
		recipe.limitations = recipe.limitations.map((line) =>
			line.startsWith("Method adds unspecified tomato oil")
				? "The measured butter supplies all cooking fat; no unmeasured tomato oil or garnish is included."
				: line,
		);
		changes.push(
			"Use only the measured butter for searing; no unmeasured tomato oil is added.",
		);
	}
	if (recipe.id === "source-creamy-cajun-shrimp-with-sausage") {
		replaceText(recipe, "optional Parmesan", "measured Parmesan");
		changes.push(
			"Retain the observed fully cooked sausage profile and full sausage/shrimp portions instead of claiming an unverified lower-carbohydrate brand.",
		);
	}
	if (recipe.id === "source-sausage-taco-cauliflower-rice-skillet") {
		changes.push(
			"Retain full sausage, cauliflower and cheese portions. Use a smaller measured tomato-and-aromatic sauce and taco seasoning; no assumed lower-carbohydrate sausage label is used.",
		);
	}
	if (recipe.id === "source-easy-cajun-pork-chops-with-lemon-garlic-zucchini") {
		Object.assign(
			nutrition.recipes[recipe.id].find(
				(row) => row.ingredientId === "ingredient-4",
			),
			profile(172336),
		);
		changes.push(
			"Match the named canola oil to the verified USDA172336canola profile, replacing the former olive-oil proxy at the same measured mass.",
		);
	}
	if (recipe.id === "source-lemon-garlic-butter-steak-with-spinach") {
		Object.assign(
			nutrition.recipes[recipe.id].find(
				(row) => row.ingredientId === "ingredient-3",
			),
			profile(173430),
		);
		changes.push(
			"Match the named ordinary butter to the existing USDA173430unsalted-butter profile, replacing the former anhydrous-butter-oil proxy at the same measured mass.",
		);
	}
	if (recipe.id === "source-italian-sausage-and-peppers-skillet") {
		replaceText(
			recipe,
			"the source method’s initial unquantified drizzle of oil",
			"the measured initial olive oil",
		);
		replaceText(
			recipe,
			"initial unquantified oil",
			"measured initial olive oil",
		);
	}
	recipe.limitations = recipe.limitations.filter(
		(text) => !STALE_LIMITATION.test(text),
	);
	recipe.limitations.push(
		"Keto quantities and sauce balance are editorial adaptations using the recorded ingredient profiles; they have not been kitchen-tested. Brand composition can differ.",
	);
	recipe.ketoAdaptation = {
		reviewedOn: DATE,
		archive: `${ARCHIVE}recipes.json`,
		changes,
		originalNutrition: originalRecipe.nutrition,
	};
	recalculate(recipe);
}

// One pass owns the copied endpoint correction, using actual ingredients and state.
for (const recipe of data.recipes) {
	const sausages = recipe.ingredients.filter((ingredient) =>
		SAUSAGE.test(ingredient.name),
	);
	const cookedSausage = sausages.some((ingredient) =>
		COOKED_SAUSAGE.test(`${ingredient.name} ${ingredient.state}`),
	);
	let endpoint;
	if (recipe.proteinType === "beef")
		endpoint = "Cook ground beef to 160°F at the thickest center.";
	if (recipe.proteinType === "pork")
		endpoint = sausages.length
			? cookedSausage
				? "Heat fully cooked sausage thoroughly according to its package instructions."
				: "Cook raw pork sausage to 160°F, or poultry sausage to 165°F."
			: "Cook whole-cut pork to 145°F at its thickest point, then rest at least 3 minutes.";
	if (recipe.proteinType === "shrimp" || SHRIMP.test(recipe.title))
		endpoint = sausages.length
			? "Cook shrimp until pearly white and opaque. Heat fully cooked sausage thoroughly according to its package instructions."
			: "Cook shrimp until the flesh is pearly white and opaque.";
	if (endpoint)
		replaceText(
			recipe,
			"Check poultry or reheated cooked chicken reaches 165°F at the thickest center.",
			endpoint,
		);
}

const published = new Set(data.recipes.map((recipe) => recipe.id));
nutrition.recipes = Object.fromEntries(
	Object.entries(nutrition.recipes).filter(([id]) => published.has(id)),
);
nutrition.familyOptions = Object.fromEntries(
	Object.entries(nutrition.familyOptions).filter(([id]) => published.has(id)),
);
data.ketoMigration = {
	reviewedOn: DATE,
	archive: ARCHIVE,
	policy:
		"Published recipes must qualify at no more than 12.5 g net carbohydrate per base serving or estimated 8 fl oz smoothie glass and have a recipe-specific shared-table note.",
};

// The reviewed calamari formula lives outside the historical import evidence.
if (!calamari.recipe || !calamari.nutritionRows)
	throw new Error("Calamari source needs recipe and nutritionRows");
data.recipes.push(calamari.recipe);
nutrition.recipes[calamari.recipe.id] = calamari.nutritionRows;
for (const reference of calamari.newWeightReferences ?? []) {
	if (!references.has(reference.id)) weights.references.push(reference);
}

await write("src/components/recipes/recipes.json", data);
await write("src/components/recipes/nutrition-data.json", nutrition);
await write("src/components/recipes/ingredient-weights.json", weights);
// Keep reruns byte-stable with the repository's committed JSON format.
const formatter = spawn(
	fileURLToPath(new URL("../../node_modules/.bin/biome", import.meta.url)),
	[
		"format",
		"--write",
		"--config-path=config/quality/biome.settings.jsonc",
		"src/components/recipes/recipes.json",
		"src/components/recipes/nutrition-data.json",
		"src/components/recipes/ingredient-weights.json",
	],
	{ cwd: ROOT, stdio: "inherit" },
);
await new Promise((resolve, reject) => {
	formatter.once("error", reject);
	formatter.once("close", (code) =>
		code === 0 ? resolve() : reject(new Error(`JSON formatter exited ${code}`)),
	);
});
console.log(
	JSON.stringify(
		{
			published: data.recipes.length,
			adapted: data.recipes.filter((recipe) => recipe.ketoAdaptation).length,
			macros: data.recipes
				.filter((recipe) => recipe.ketoAdaptation)
				.map((recipe) => ({
					id: recipe.id,
					netCarbs: recipe.nutrition.net_carbs_g,
				})),
		},
		null,
		"\t",
	),
);
