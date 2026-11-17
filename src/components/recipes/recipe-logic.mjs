// Pure calculations for the meal library. Recipe ingredient amounts are for
// BASE_SERVINGS (four) adults.
import { BASE_SERVINGS, KETO_NET_CARBS_MAX } from "./constants.mjs";
import { ingredientGrams, ingredientMeasure } from "./ingredient-units.mjs";
import { familyFat, macroNutrition } from "./nutrition.mjs";
import { validateSettings } from "./recipe-settings.mjs";

const NUTRIENTS = [
	"kcal",
	"protein_g",
	"fat_g",
	"carbs_g",
	"fiber_g",
	"net_carbs_g",
];

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Use familiar fractions for kitchen measures; retain two decimals otherwise. */
export function formatQuantity(value) {
	if (!finite(value)) return "—";
	if (value === 0) return "0";
	const sign = value < 0 ? "−" : "";
	const magnitude = Math.abs(value);
	if (magnitude >= 10) return sign + Number(magnitude.toFixed(2)).toString();
	const whole = Math.floor(magnitude + 1e-9);
	const remainder = magnitude - whole;
	const fractions = [
		[0, ""],
		[1 / 8, "⅛"],
		[1 / 6, "⅙"],
		[1 / 4, "¼"],
		[1 / 3, "⅓"],
		[3 / 8, "⅜"],
		[1 / 2, "½"],
		[5 / 8, "⅝"],
		[2 / 3, "⅔"],
		[3 / 4, "¾"],
		[5 / 6, "⅚"],
		[7 / 8, "⅞"],
		[1, ""],
	];
	const fraction = fractions.find(
		([decimal]) => Math.abs(remainder - decimal) < 0.012,
	);
	if (fraction) {
		const integer = whole + (fraction[0] === 1 ? 1 : 0);
		return (
			sign +
			(fraction[1]
				? `${integer ? `${integer} ` : ""}${fraction[1]}`
				: String(integer))
		);
	}
	return sign + Number(magnitude.toFixed(2)).toString();
}

/** Minimum seasonings retain their baseline amount for smaller batches. */
export function ingredientAmount(ingredient, servings) {
	const amount = ingredient?.amount;
	if (!Number.isFinite(amount)) return NaN;
	const validServings = validateSettings({ servings }).servings;
	if (ingredient.scale === "fixed") return amount;
	if (ingredient.scale === "whole-batch")
		return amount * Math.ceil(validServings / BASE_SERVINGS);
	const scaled = (amount * validServings) / BASE_SERVINGS;
	return ingredient.scale === "minimum" ? Math.max(amount, scaled) : scaled;
}

/** Scale once from the canonical amount, then show useful simultaneous measures. */
export function formatIngredient(ingredient, servings, units = "metric") {
	return ingredientMeasure(
		ingredient,
		ingredientAmount(ingredient, servings),
		units,
		formatQuantity,
	).quantity;
}

/** Safe endpoints round upward; appliance settings round to the nearest 5°C. */
export function temperature(fahrenheit, units = "us", safety = false) {
	if (!finite(fahrenheit)) return "—";
	const original = `${formatQuantity(fahrenheit)}°F`;
	if (units === "us") return original;
	const celsius = ((fahrenheit - 32) * 5) / 9;
	const shown = safety
		? Math.ceil(celsius - 1e-10)
		: Math.round(celsius / 5) * 5;
	return `${shown}°C (${original})`;
}

/** Shuffle a copy, preserving the canonical recipe collection. */
export function shuffleRecipes(recipes, random = Math.random) {
	const result = [...recipes];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export function servingNutrition(recipe, servings = BASE_SERVINGS) {
	const count = validateSettings({ servings }).servings;
	return macroNutrition(recipe, count, ingredientAmount);
}

/** Smoothie volumes are explicit estimates, separate from the canonical per-recipe-portion macros. */
function smoothieGlassesPerBatch(recipe, fluidOunces = 8) {
	if (recipe.type !== "smoothie" || !finite(fluidOunces) || fluidOunces <= 0)
		throw new Error("A smoothie and positive glass size are required.");
	if (!finite(recipe.estimatedYieldMl) || recipe.estimatedYieldMl <= 0)
		throw new Error("Estimated smoothie yield is required.");
	return recipe.estimatedYieldMl / (fluidOunces * 29.5735295625);
}
export function smoothiePortionNutrition(recipe, fluidOunces = 8) {
	const glassesPerBatch = smoothieGlassesPerBatch(recipe, fluidOunces);
	const nutrition = servingNutrition(recipe);
	const nutrients =
		nutrition.erythritol_g === undefined
			? NUTRIENTS
			: [...NUTRIENTS, "erythritol_g"];
	return Object.fromEntries(
		nutrients.map((key) => [
			key,
			finite(nutrition[key])
				? (nutrition[key] * BASE_SERVINGS) / glassesPerBatch
				: null,
		]),
	);
}
export function displayNutrition(recipe, servings = BASE_SERVINGS) {
	return recipe.type === "smoothie"
		? smoothiePortionNutrition(recipe)
		: servingNutrition(recipe, servings);
}
/** Classification always uses the base meal's four-serving portion or smoothie glass. */
export function dietaryClass(recipe) {
	const netCarbs = displayNutrition(recipe).net_carbs_g;
	if (!finite(netCarbs))
		throw new Error(`${recipe.id}: net carbohydrate estimate is required`);
	return netCarbs <= KETO_NET_CARBS_MAX ? "keto" : "nonketo";
}

/** Optional sides are selected explicitly; missing or stale choices mean no side. */
export function selectedSide(recipe, choiceId) {
	return recipe.familyOptions?.find((option) => option.id === choiceId);
}

export function nutritionHeading(recipe) {
	return recipe.type === "smoothie"
		? "Nutrition per 8 fl oz (237 mL) glass"
		: "Nutrition per serving";
}
export function nutritionPortionLabel(recipe, servings = BASE_SERVINGS) {
	return recipe.type === "smoothie"
		? "per estimated 8 fl oz (237 mL) glass"
		: `per serving (1/${validateSettings({ servings }).servings} of prepared batch)`;
}
export function smoothieYieldNote(recipe, servings = BASE_SERVINGS) {
	const glasses =
		(smoothieGlassesPerBatch(recipe) *
			validateSettings({ servings }).servings) /
		BASE_SERVINGS;
	return `This batch makes about ${glasses.toFixed(1)} eight-fluid-ounce glasses. Yield is estimated; added liquid and blending affect actual volume.`;
}

/** One explicitly chosen side portion, independently of the base meal or diner count. */
export function sideNutrition(recipe, choiceId) {
	const option = selectedSide(recipe, choiceId);
	return option
		? { ...option.nutrition, fat_g: familyFat(recipe, option.id) }
		: null;
}

export function capacityNote(servings) {
	const count = validateSettings({ servings }).servings;
	if (count > BASE_SERVINGS)
		return "More than four servings may need extra pan or basket batches. Keep the stated food thickness and thermometer endpoint; total time can increase.";
	if (count < BASE_SERVINGS)
		return "Use the stated cook times as a starting point for this smaller batch. Check the thermometer endpoint; do not shorten a pressure minimum.";
	return "The listed pan and basket capacity, cook times, and thermometer endpoint are for four servings.";
}

/** Package counts are shopping estimates; recipe weights remain the measured target. */
export function purchaseNote(ingredient, servings = BASE_SERVINGS) {
	const pack = ingredient?.package;
	if (!pack || !finite(pack.grams) || pack.grams <= 0) return "";
	const amount = ingredientGrams(
		ingredient,
		ingredientAmount(ingredient, servings),
	);
	const count = Math.ceil(amount / pack.grams - 1e-10);
	return pack.drained
		? `About ${count} × ${pack.label}, assuming ~${pack.grams} g drained per can; check actual yield.`
		: `Buy ${count} × ${pack.label}; measure out the required weight.`;
}

/** Use the upper end of the documented elapsed-time estimate; absent times stay absent. */
export function totalTimeLabel(recipe, servings = BASE_SERVINGS) {
	if (!finite(recipe.totalMin) || !finite(recipe.totalMax))
		return "Not provided";
	return `${recipe.totalMax} min${servings > BASE_SERVINGS ? " / base batch" : ""}`;
}

/** Preserve absent source nutrition on screen, in print and in exports. */
