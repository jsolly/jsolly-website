import { cookText } from "./display-units.mjs";
import { ingredientMeasure } from "./ingredient-units.mjs";
import {
	formatQuantity,
	ingredientAmount,
	validateSettings,
} from "./recipe-logic.mjs";

const QUANTITY =
	/\{\{(?<kind>mass|quantity):(?<value>[\w.-]+)(?::(?<fraction>[\d.]+))?\}\}/gu;
const PORTION =
	/\{\{portion:(?<id>[\w-]+):(?<unit>tsp|tbsp|cup|g|oz|lb|ml):(?<amount>[\d.]+)\}\}/gu;

/** Resolve explicitly identified cooking amounts without rewriting nutrition or package prose. */
export function cookingText(recipe, value, settings = {}) {
	const { servings, units } = validateSettings(settings);
	const portionText = (value || "").replace(
		PORTION,
		(_token, key, unit, amount) => {
			const ingredient = recipe.ingredients.find((item) => item.id === key);
			if (!ingredient)
				throw new Error(`Unknown cooking quantity: ${recipe.id}/${key}`);
			return ingredientMeasure(
				{
					...ingredient,
					unit,
					amount: Number(amount),
					alternatives: undefined,
				},
				(Number(amount) * ingredientAmount(ingredient, servings)) /
					ingredient.amount,
				units,
				formatQuantity,
			).quantity;
		},
	);
	const text = portionText.replace(QUANTITY, (_token, kind, key, fraction) => {
		const ingredient =
			kind === "mass"
				? { id: "cooking-portion", amount: Number(key), unit: "g" }
				: recipe.ingredients.find((item) => item.id === key);
		if (!ingredient)
			throw new Error(`Unknown cooking quantity: ${recipe.id}/${key}`);
		const amount =
			kind === "mass"
				? ingredient.amount
				: ingredientAmount(ingredient, servings) * Number(fraction ?? 1);
		return ingredientMeasure(ingredient, amount, units, formatQuantity)
			.quantity;
	});
	if (text.includes("{{"))
		throw new Error(`Invalid cooking quantity: ${recipe.id}`);
	return cookText(text, units);
}
