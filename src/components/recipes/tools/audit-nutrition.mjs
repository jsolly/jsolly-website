// Deterministic audit of every recipe and supported serving count. No network calls.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SERVING_CHOICES } from "../constants.mjs";
import data from "../nutrition-data.json" with { type: "json" };
import recipes from "../recipe-data.server.mjs";
import {
	displayNutrition,
	ingredientAmount,
	nutritionPortionLabel,
} from "../recipe-logic.mjs";

/** USDA food-specific energy, fiber, alcohol and label rounding do not equal universal 4/4/9. */
export function energyAudit(nutrition) {
	const fields = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"];
	if (
		fields.some((key) => !Number.isFinite(nutrition[key]) || nutrition[key] < 0)
	)
		return { issue: "Missing or invalid energy/macronutrient observation" };
	const generalAtwaterKcal =
		4 * nutrition.protein_g +
		4 * (nutrition.carbs_g - (nutrition.erythritol_g ?? 0)) +
		9 * nutrition.fat_g;
	const differenceKcal = nutrition.kcal - generalAtwaterKcal;
	// A review trigger, not an assertion that all foods share universal factors.
	const reviewThresholdKcal = Math.max(25, nutrition.kcal * 0.1);
	return {
		generalAtwaterKcal,
		differenceKcal,
		reviewThresholdKcal,
		issue:
			Math.abs(differenceKcal) > reviewThresholdKcal
				? "Energy differs from general 4/4/9 by over 10% and 25 kcal; review its source model"
				: null,
	};
}

/** An independent ingredient sum and largest-contribution bound reject mixed publisher fat. */
export function ingredientFatAudit(recipe, servings, displayedFat) {
	const denominator =
		recipe.type === "smoothie"
			? ((recipe.estimatedYieldMl / (8 * 29.5735295625)) * servings) / 4
			: servings;
	const contributions = data.recipes[recipe.id].map((row) => {
		const ingredient = recipe.ingredients.find(
			(item) => item.id === row.ingredientId,
		);
		return (
			(((row.grams * row.nutrients.fat) / 100) *
				ingredientAmount(ingredient, servings)) /
			ingredient.amount /
			denominator
		);
	});
	const ingredientFatGrams = contributions.reduce(
		(sum, amount) => sum + amount,
		0,
	);
	const largestIngredientFatGrams = Math.max(...contributions);
	return {
		ingredientFatGrams,
		largestIngredientFatGrams,
		issue:
			!Number.isFinite(displayedFat) ||
			displayedFat + 1e-8 < largestIngredientFatGrams ||
			Math.abs(displayedFat - ingredientFatGrams) > 1e-8
				? "Displayed fat must equal all measured ingredient contributions and cannot be below a single ingredient's fat"
				: null,
	};
}

export function auditNutrition() {
	const entries = recipes.recipes.map((recipe) => ({
		recipeId: recipe.id,
		ingredientCount: recipe.ingredients.length,
		fatBasis:
			"Sum of reviewed ingredient total fat observations at measured edible weights; no calorie residual inference.",
		sourceUrls: [
			...new Set(
				data.recipes[recipe.id].flatMap((row) => [
					row.nutrientSources?.fat ?? row.source,
				]),
			),
		],
		servings: SERVING_CHOICES.map((servings) => {
			const nutrition = displayNutrition(recipe, servings);
			return {
				servings,
				portion: nutritionPortionLabel(recipe, servings),
				nutrition,
				energy: energyAudit(nutrition),
				fat: ingredientFatAudit(recipe, servings, nutrition.fat_g),
			};
		}),
	}));
	return {
		recipeCount: entries.length,
		ingredientCount: entries.reduce(
			(sum, recipe) => sum + recipe.ingredientCount,
			0,
		),
		policy:
			"Fat is observed or explicitly estimated from food identity, never inferred from calorie residuals. General 4/4/9 is a discrepancy screen: USDA specific Atwater factors, fiber, alcohol, organic acids, sugar alcohols and rounded labels can differ. Review triggers require a recorded correction or explanation.",
		entries,
	};
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	console.log(JSON.stringify(auditNutrition(), null, "\t"));
}
