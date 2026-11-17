import { BASE_SERVINGS } from "./constants.mjs";

const MACROS = ["kcal", "protein_g", "carbs_g", "fiber_g", "erythritol_g"];

function contributionFactor(recipe, row, servings, scaledAmount) {
	const ingredient = recipe.ingredients.find(
		(item) => item.id === row.ingredientId,
	);
	if (
		!ingredient ||
		!Number.isFinite(ingredient.amount) ||
		ingredient.amount <= 0
	)
		throw new Error(
			`Invalid nutrition ingredient link: ${recipe.id}/${row.ingredientId}`,
		);
	return scaledAmount(ingredient, servings) / ingredient.amount;
}

function glassesPerBatch(recipe) {
	if (!Number.isFinite(recipe.estimatedYieldMl) || recipe.estimatedYieldMl <= 0)
		throw new Error(`Missing smoothie yield: ${recipe.id}`);
	return recipe.estimatedYieldMl / (8 * 29.5735295625);
}

/** Total fat follows the same measured ingredient model as energy and macros. */
function fatNutrition(recipe, servings, scaledAmount) {
	const rows = recipe.calculation?.rows || [];
	if (!rows.length || rows.some((row) => !Number.isFinite(row.nutrients.fat)))
		return null;
	return (
		rows.reduce(
			(total, row) =>
				total +
				((row.nutrients.fat * row.grams) / 100) *
					contributionFactor(recipe, row, servings, scaledAmount),
			0,
		) / servings
	);
}

// Four-serving estimates are reconciled from the model at migration/refresh time.
// Only nonlinear ingredients change a per-serving estimate when the batch changes.
export function macroNutrition(recipe, servings, scaledAmount) {
	const result = { ...recipe.nutrition };
	result.fat_g = fatNutrition(recipe, servings, scaledAmount);
	for (const row of recipe.calculation?.rows || []) {
		const adjustment =
			contributionFactor(recipe, row, servings, scaledAmount) -
			servings / BASE_SERVINGS;
		if (Math.abs(adjustment) < 1e-12) continue;
		for (const key of MACROS) {
			if (!Number.isFinite(result[key])) continue;
			const amount = row.macros?.[key] ?? (key === "erythritol_g" ? 0 : null);
			result[key] = Number.isFinite(amount)
				? result[key] + (((amount * row.grams) / 100) * adjustment) / servings
				: null;
		}
	}
	result.net_carbs_g =
		Number.isFinite(result.carbs_g) && Number.isFinite(result.fiber_g)
			? Math.max(
					0,
					result.carbs_g - result.fiber_g - (result.erythritol_g ?? 0),
				)
			: null;
	return result;
}

/** A selected family starch is one additional diner portion, never batch-scaled. */
export function familyFat(recipe, choiceId) {
	const row = recipe.calculation?.familyRows?.find(
		(item) => item.ingredientId === choiceId,
	);
	return Number.isFinite(row?.nutrients.fat)
		? (row.nutrients.fat * row.grams) / 100
		: null;
}
export function dailyNutrition(recipe, servings, scaledAmount) {
	const rows = recipe.calculation?.rows || [];
	return (recipe.calculation?.nutrients ?? []).map((nutrient) => {
		let total = 0,
			observed = rows.length > 0;
		for (const row of rows) {
			if (!Number.isFinite(row.nutrients[nutrient.key])) {
				observed = false;
				continue;
			}
			const factor = contributionFactor(recipe, row, servings, scaledAmount);
			total +=
				(((row.nutrients[nutrient.key] * row.grams) / 100) * factor) / servings;
		}
		if (nutrient.key === "fat" && observed)
			total = fatNutrition(recipe, servings, scaledAmount);
		if (recipe.type === "smoothie") {
			if (
				!Number.isFinite(recipe.estimatedYieldMl) ||
				recipe.estimatedYieldMl <= 0
			)
				observed = false;
			else total *= BASE_SERVINGS / glassesPerBatch(recipe);
		}
		return {
			...nutrient,
			amount: observed ? total : null,
			percent: observed
				? Math.round((total / nutrient.dailyValue) * 100)
				: null,
		};
	});
}
/** @param {number | null} value */
export function nutrientAmount(value) {
	if (value === null) return "—";
	if (value === 0) return "0";
	if (value < 0.1) return "<0.1";
	return value < 10
		? String(Math.round(value * 10) / 10)
		: String(Math.round(value));
}

// Count recorded omega-3 observations only; unobserved fatty acids cannot qualify a recipe.
export function recordedOmega3(recipe, servings, scaledAmount) {
	let total = 0;
	for (const row of recipe.calculation?.rows || []) {
		const factor = contributionFactor(recipe, row, servings, scaledAmount);
		total +=
			((((row.omega3RecordedGramsPer100g || 0) * row.grams) / 100) * factor) /
			servings;
	}
	return recipe.type === "smoothie"
		? (total * BASE_SERVINGS) / glassesPerBatch(recipe)
		: total;
}
