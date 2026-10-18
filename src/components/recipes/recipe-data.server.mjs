// Canonical registries are server/build inputs. Browser recipes carry only their own context.
import weights from "./ingredient-weights.json" with { type: "json" };
import nutrition from "./nutrition-data.json" with { type: "json" };
import canonical from "./recipes.json" with { type: "json" };

const references = new Map(
	weights.references.map((reference) => [reference.id, reference]),
);

export function ingredientWithContext(ingredient) {
	const reference = ingredient.weightRef
		? references.get(ingredient.weightRef)
		: undefined;
	if (ingredient.weightRef && !reference)
		throw new Error(
			`Unknown ingredient weight reference: ${ingredient.weightRef}`,
		);
	return {
		...ingredient,
		...(reference ? { weightReference: reference } : {}),
		...(ingredient.alternatives
			? { alternatives: ingredient.alternatives.map(ingredientWithContext) }
			: {}),
	};
}

function recipeWithContext(recipe) {
	return {
		...recipe,
		ingredients: recipe.ingredients.map(ingredientWithContext),
		familyOptions: recipe.familyOptions.map(ingredientWithContext),
		calculation: {
			nutrients: nutrition.nutrients,
			rows: nutrition.recipes[recipe.id] ?? [],
			familyRows: nutrition.familyOptions[recipe.id] ?? [],
		},
	};
}

export default {
	...canonical,
	recipes: canonical.recipes.map(recipeWithContext),
};
