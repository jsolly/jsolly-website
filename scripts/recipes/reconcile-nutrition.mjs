// Reconcile reviewed nutrient profiles to the measured cooking ingredients.
// The cache contains public USDA responses; this command never fetches or rematches foods.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { observation } from "./usda-observation.mjs";

const FDC_URL = /food-details\/(?<id>\d+)\/nutrients$/u;
const OBSOLETE_ASSUMPTION =
	/g edible food per|unmeasured|to.taste|nutrition only/iu;
const CACHE_FILE = /^\d+\.json$/u;
const foodId = (row) => Number(row.source?.match(FDC_URL)?.groups.id) || null;

const ROOT = new URL("../../", import.meta.url);
const MACROS = { kcal: 1008, protein_g: 1003, carbs_g: 1005, fiber_g: 1079 };
const ALIASES = {
	hemp: "hemp_hearts",
	salt: "fine_salt",
	paprika: "smoked_paprika",
	oregano: "dried_oregano",
	yeast: "nutritional_yeast",
	pesto_label: "basil_pesto",
	lettuce: "salad_greens",
	sausage: "chicken_italian_sausage",
	cumin: "ground_cumin",
	yogurt2: "strained_greek_yogurt",
	salsa: "salsa_verde",
	turkey93: "ground_turkey",
	flax: "ground_flaxseed",
	lentils_cooked: "lentils_canned",
	tomato_canned: "diced_tomatoes",
	spinach_raw: "baby_spinach",
	chickpeas_rinsed: "chickpeas_canned",
	harissa: "mild_harissa",
	potato: "baby_potatoes",
	gnocchi: "shelf_stable_gnocchi",
	tomato_raw: "cherry_tomatoes",
};
const EXTRA_ALIASES = {
	"keto-zuppa-toscana/red_pepper": "crushed_red_pepper",
	"sheet-pan-chicken-fajitas/red_pepper": "bell_pepper",
};
const DEFAULT_PROFILES = {
	"crushed chili pepper flakes": 170932,
	"crushed red chili pepper flakes": 170932,
	"red chili pepper flakes": 170932,
	"crushed red pepper flakes": 170932,
	"lemon slices": 167746,
	"cayenne pepper": 170932,
	"ancho chili powder": 170932,
	"red chili powder": 170932,
	"fresh basil": 172232,
	"fresh chopped basil": 172232,
	"chopped fresh basil": 172232,
};
const KEYS = Object.keys(MACROS);
const snapshot = ({ name, amount, unit, state }) => ({
	name,
	amount,
	unit,
	state,
});

export function observedProfile(food, nutrients) {
	const observedNutrients = nutrients.map((nutrient) => [
		nutrient.key,
		observation(food, nutrient.usdaId, nutrient.unit),
	]);
	return {
		fdcId: food.fdcId,
		description: food.description,
		source: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
		nutrients: Object.fromEntries(
			observedNutrients.filter(([, amount]) => amount !== undefined),
		),
		macros: Object.fromEntries(
			Object.entries(MACROS).map(([key, id]) => [
				key,
				observation(food, id, key === "kcal" ? "kcal" : "g") ?? null,
			]),
		),
		omega3RecordedGramsPer100g: [1404, 1278, 1272].reduce(
			(sum, id) => sum + (observation(food, id, "g") ?? 0),
			0,
		),
		assumedMacroFields: [],
	};
}

function total(rows, key) {
	return rows.reduce(
		(sum, row) => sum + (row.macros[key] * row.grams) / 100,
		0,
	);
}

export function reconcileMacros(recipe, rows, baseServings) {
	const publisherFields = [];
	for (const key of KEYS) {
		if (rows.every((row) => Number.isFinite(row.macros[key])))
			recipe.nutrition[key] = total(rows, key) / baseServings;
		else {
			let difference = 0;
			for (const row of rows) {
				const prior = row.measurementBaseline;
				if (
					!Number.isFinite(row.macros[key]) ||
					!Number.isFinite(prior.macros[key])
				) {
					if (Math.abs(row.grams - prior.grams) > 1e-8)
						throw new Error(
							`Unobserved ${key} changed mass: ${recipe.id}/${row.ingredientId}`,
						);
					continue;
				}
				difference +=
					(row.macros[key] * row.grams - prior.macros[key] * prior.grams) / 100;
			}
			recipe.nutrition[key] =
				recipe.measurementNutritionBaseline[key] + difference / baseServings;
			publisherFields.push(key);
		}
	}
	const erythritol =
		rows.reduce(
			(sum, row) => sum + ((row.macros.erythritol_g ?? 0) * row.grams) / 100,
			0,
		) / baseServings;
	if (erythritol > 0) recipe.nutrition.erythritol_g = erythritol;
	else {
		// biome-ignore lint/performance/noDelete: absence is part of this maintenance output contract; undefined would leave a stale own property.
		delete recipe.nutrition.erythritol_g;
	}
	recipe.nutrition.net_carbs_g = Math.max(
		0,
		recipe.nutrition.carbs_g - recipe.nutrition.fiber_g - erythritol,
	);
	return publisherFields;
}

/** Inputs are cloned; callers own publication of recipe metadata and regenerated files. */
export function reconcileNutrition(
	nutrition,
	recipes,
	{
		gramsForIngredient,
		profileForIngredient,
		macroProfile,
		familyProfile,
		replacementProfile,
	},
) {
	const result = structuredClone(nutrition);
	const recipeResult = structuredClone(recipes);
	for (const recipe of recipeResult.recipes) {
		const rows = result.recipes[recipe.id];
		for (const row of rows) {
			row.ingredientId ??= recipe.ingredients.some((i) => i.id === row.food)
				? row.food
				: (EXTRA_ALIASES[`${recipe.id}/${row.food}`] ?? ALIASES[row.food]);
			const ingredient = recipe.ingredients.find(
				(i) => i.id === row.ingredientId,
			);
			if (!ingredient)
				throw new Error(`Unlinked nutrition row: ${recipe.id}/${row.food}`);
			row.macros ??= row.macrosPer100g ?? macroProfile(row);
			if (!row.macros)
				throw new Error(`Missing macro profile: ${recipe.id}/${row.food}`);
			// biome-ignore lint/performance/noDelete: migration removes the obsolete serialized field.
			delete row.macrosPer100g;
			row.measurementBaseline ??= {
				grams: row.grams,
				macros: structuredClone(row.macros),
			};
			const replacement = replacementProfile?.(ingredient, recipe, row);
			if (replacement && replacement.fdcId !== foodId(row)) {
				row.previousProfile ??= {
					source: row.source,
					description: row.description,
					nutrients: structuredClone(row.nutrients),
					macros: structuredClone(row.macros),
				};
				Object.assign(row, structuredClone(replacement));
				row.macroSource = replacement.source;
			}
		}
		for (const ingredient of recipe.ingredients) {
			if (rows.some((row) => row.ingredientId === ingredient.id)) continue;
			const profile = profileForIngredient(ingredient, recipe);
			if (!profile)
				throw new Error(
					`Missing reviewed nutrient profile: ${recipe.id}/${ingredient.id} (${ingredient.name})`,
				);
			const priorGrams = profile.includedInPublisherBaseline
				? gramsForIngredient(ingredient)
				: 0;
			rows.push({
				...structuredClone(profile),
				food: ingredient.id,
				ingredientId: ingredient.id,
				grams: priorGrams,
				measurementBaseline: {
					grams: priorGrams,
					macros: structuredClone(profile.macros),
				},
			});
		}
		for (const row of rows) {
			const ingredient = recipe.ingredients.find(
				(i) => i.id === row.ingredientId,
			);
			const cookingGrams = gramsForIngredient(ingredient);
			if (!Number.isFinite(cookingGrams) || cookingGrams <= 0)
				throw new Error(`Invalid cooking mass: ${recipe.id}/${ingredient.id}`);
			const purchased =
				ingredient.measurementProvenance?.massBasis === "as-purchased";
			if (!row.measurementReconciliation) {
				// Existing whole-bird/count assumptions and documented bone-in yield survive
				// the cooking mass migration. They never become purchased grams of food.
				const edibleFraction = purchased ? row.grams / cookingGrams : 1;
				if (!(edibleFraction > 0 && edibleFraction <= 1))
					throw new Error(`Review edible yield: ${recipe.id}/${ingredient.id}`);
				row.measurementReconciliation = {
					edibleFraction,
					basis: purchased
						? "edible fraction of purchased mass; retained reviewed nutrition yield"
						: "edible cooking mass",
				};
			}
			row.grams = cookingGrams * row.measurementReconciliation.edibleFraction;
			row.measurementReconciliation.cookingGrams = cookingGrams;
			row.ingredientSnapshot = snapshot(ingredient);
		}
		recipe.measurementNutritionBaseline ??= structuredClone(recipe.nutrition);
		const publisherFields = reconcileMacros(recipe, rows, recipes.baseServings);
		for (const ingredient of recipe.ingredients) {
			// biome-ignore lint/performance/noDelete: migration removes the obsolete serialized field.
			delete ingredient.nutritionBatch;
		}
		const estimate = {
			method:
				"Measured cooking grams, reduced by explicit edible yield where applicable, times observed nutrients per 100 g. All listed measured ingredients, including optional defaults, are included. No cooking-retention factors.",
			estimatedMacroFields: [...KEYS, "net_carbs_g"],
			publisherBaselineFields: publisherFields,
			ingredientSnapshot: recipe.ingredients.map((ingredient) => ({
				id: ingredient.id,
				...snapshot(ingredient),
			})),
		};
		if (recipe.sourceRecipe) {
			recipe.sourceRecipe.preMeasurementNutritionEstimate ??= structuredClone(
				recipe.sourceRecipe.nutritionEstimate,
			);
			recipe.sourceRecipe.nutritionEstimate = {
				...estimate,
				assumptions: (
					recipe.sourceRecipe.preMeasurementNutritionEstimate?.assumptions ?? []
				)
					.filter((assumption) => !OBSOLETE_ASSUMPTION.test(assumption))
					.map((assumption) => {
						for (const row of rows) {
							if (!row.previousProfile?.description || !row.description)
								continue;
							const ingredient = recipe.ingredients.find(
								(item) => item.id === row.ingredientId,
							);
							const originalName =
								ingredient.measurementProvenance?.original.name ??
								ingredient.name;
							if (assumption.startsWith(`${originalName}:`))
								assumption = assumption.replace(
									row.previousProfile.description,
									row.description,
								);
						}
						return assumption;
					}),
			};
			recipe.sourceRecipe.nutritionBasis = publisherFields.length
				? "Ingredient-based estimates except fields listed in publisherBaselineFields, which retain the publisher baseline plus observed ingredient corrections. Original publisher nutrition is preserved separately."
				: "Nutrition estimates follow the measured ingredients and recorded edible yields. Original publisher nutrition is preserved separately.";
		} else recipe.nutritionEstimate = estimate;
	}
	if (familyProfile) {
		result.familyOptions = {};
		for (const recipe of recipeResult.recipes) {
			if (!recipe.familyOptions.length) continue;
			result.familyOptions[recipe.id] = recipe.familyOptions.map((option) => {
				const profile = familyProfile(option);
				const grams = gramsForIngredient(option);
				if (!profile || !Number.isFinite(grams) || grams <= 0)
					throw new Error(`Invalid family model: ${recipe.id}/${option.id}`);
				const row = {
					...structuredClone(profile),
					ingredientId: option.id,
					grams,
				};
				option.nutrition = Object.fromEntries(
					KEYS.map((key) => [
						key,
						Number.isFinite(row.macros?.[key])
							? (row.macros[key] * grams) / 100
							: null,
					]),
				);
				option.nutrition.net_carbs_g =
					Number.isFinite(option.nutrition.carbs_g) &&
					Number.isFinite(option.nutrition.fiber_g)
						? Math.max(0, option.nutrition.carbs_g - option.nutrition.fiber_g)
						: null;
				return row;
			});
		}
	}
	result.method =
		"Sum edible gram weights times recorded per-100-g composition, following each cooking ingredient's actual scaling. All listed measured ingredients and optional defaults are included. Reviewed generic profiles and brand labels remain estimates; no cooking-retention factors. Unobserved nutrients remain missing. Publisher nutrition is preserved separately from corrected ingredient estimates.";
	result.measurementMethod =
		"Every row links to a cooking ingredientId; grams are edible weights. Scaling follows that ingredient's actual unrounded amount. Missing observations remain missing. measurementBaseline retains the pre-migration contribution for publisher-baseline corrections.";
	return { nutrition: result, recipes: recipeResult };
}

async function main() {
	const [cache, output] = process.argv.slice(2);
	if (!cache?.startsWith("/") || !output?.startsWith("/"))
		throw new Error(
			"Usage: node scripts/recipes/reconcile-nutrition.mjs /absolute/usda-cache /absolute/recipe-output.json",
		);
	const read = async (path) =>
		JSON.parse(await readFile(new URL(path, ROOT), "utf8"));
	const nutrition = await read("src/components/recipes/nutrition-data.json");
	const recipes = await read("src/components/recipes/recipes.json");
	const registry = await read("src/components/recipes/ingredient-weights.json");
	const evidence = await read(
		"docs/recipes-evidence/nutrition-calculations.json",
	);
	const records = await Promise.all(
		(await readdir(cache))
			.filter((file) => CACHE_FILE.test(file))
			.map(
				async (file) =>
					JSON.parse(await readFile(`${cache}/${file}`, "utf8")).food,
			),
	);
	const foods = new Map(records.map((food) => [food.fdcId, food]));
	const profile = (id) =>
		foods.has(id)
			? observedProfile(foods.get(id), nutrition.nutrients)
			: undefined;
	const { ingredientGrams } = await import(
		"../../src/components/recipes/ingredient-units.mjs"
	);
	const result = reconcileNutrition(nutrition, recipes, {
		gramsForIngredient: ingredientGrams,
		replacementProfile: (ingredient) => {
			const reference = registry.references.find(
				(item) => item.id === ingredient.weightRef,
			);
			const selectedId =
				reference?.nutritionFdcId ??
				DEFAULT_PROFILES[ingredient.name.toLowerCase()];
			if (!selectedId) return;
			const replacement = profile(selectedId);
			if (!replacement)
				throw new Error(`Missing reviewed replacement profile: ${selectedId}`);
			return replacement;
		},
		macroProfile: (row) => {
			const prior = evidence.foods[row.food];
			if (prior && (!prior.fdc_id || prior.fdc_id === foodId(row))) {
				row.macroSource = prior.source;
				return Object.fromEntries(KEYS.map((key) => [key, prior[key]]));
			}
			return profile(foodId(row))?.macros;
		},
		familyProfile: (option) =>
			profile(foodId(evidence.addons[option.id] ?? {})),
		profileForIngredient: (ingredient, recipe) => {
			const reference = registry.references.find(
				(item) => item.id === ingredient.weightRef,
			);
			const byReference = profile(
				reference?.fdcId ?? DEFAULT_PROFILES[ingredient.name.toLowerCase()],
			);
			if (byReference) return byReference;
			if (ingredient.id === "xanthan")
				return Object.values(nutrition.recipes)
					.flat()
					.find(
						(row) =>
							row.source === "https://www.bobsredmill.com/product/xanthan-gum",
					);
			const brands = {
				"source-cheesy-chicken-zucchini-boats-recipe/ingredient-5": [
					"Dry ranch seasoning; nutrient observations unavailable",
					"https://www.hiddenvalley.com/products/ranch-seasonings/seasoning-mix-packets/original-ranch-seasoning-mix-packet/",
				],
				"source-grilled-salmon-kabobs-with-greek-marinade/ingredient-7": [
					"Brown monkfruit sweetener; nutrient observations unavailable",
					"https://www.maebells.com/grilled-salmon-kabobs/",
				],
				"source-keto-shrimp-and-broccoli-recipe/ingredient-6": [
					"Brown monkfruit sweetener; nutrient observations unavailable",
					"https://www.maebells.com/keto-shrimp-and-broccoli/",
				],
			};
			const brand = brands[`${recipe.id}/${ingredient.id}`];
			if (brand)
				return {
					description: brand[0],
					source: brand[1],
					includedInPublisherBaseline: true,
					nutrients: {},
					macros: Object.fromEntries(KEYS.map((key) => [key, null])),
				};
		},
	});
	if (JSON.stringify(nutrition) !== JSON.stringify(result.nutrition)) {
		await writeFile(
			new URL("src/components/recipes/nutrition-data.json", ROOT),
			`${JSON.stringify(result.nutrition, null, "\t")}\n`,
		);
	}
	await writeFile(output, `${JSON.stringify(result.recipes, null, "\t")}\n`);
	console.log(
		`Reconciled ${result.recipes.recipes.length} recipes; review recipe metadata at ${output}.`,
	);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
