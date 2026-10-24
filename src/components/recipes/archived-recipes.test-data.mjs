// Preserve historical recipe contracts without publishing retired recipes.
import weights from "../../../docs/recipes-archive/keto-2026-10-23/ingredient-weights.json" with {
	type: "json",
};
import nutrition from "../../../docs/recipes-archive/keto-2026-10-23/nutrition-data.json" with {
	type: "json",
};
import canonical from "../../../docs/recipes-archive/keto-2026-10-23/recipes.json" with {
	type: "json",
};

const references = new Map(
	weights.references.map((reference) => [reference.id, reference]),
);
const withReference = (ingredient) => ({
	...ingredient,
	...(ingredient.weightRef
		? { weightReference: references.get(ingredient.weightRef) }
		: {}),
	...(ingredient.alternatives
		? { alternatives: ingredient.alternatives.map(withReference) }
		: {}),
});

export const archivedNutrition = nutrition;
export const archivedRecipes = canonical.recipes.map((recipe) => ({
	...recipe,
	ingredients: recipe.ingredients.map(withReference),
	familyOptions: recipe.familyOptions.map(withReference),
	calculation: {
		nutrients: nutrition.nutrients,
		rows: nutrition.recipes[recipe.id],
		familyRows: nutrition.familyOptions[recipe.id] ?? [],
	},
}));
