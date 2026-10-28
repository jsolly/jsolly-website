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

// Archived v1 flows predate equipment metadata. Keep the archive untouched;
// adapt these historical test fixtures with the neutral utensil identifier.
const archivedFlow = (node) =>
	node.children
		? {
				...node,
				equipment: ["Kitchen utensils"],
				children: node.children.map(archivedFlow),
			}
		: { ...node };

export const archivedNutrition = nutrition;
export const archivedRecipes = canonical.recipes.map((recipe) => ({
	...recipe,
	flow: { ...recipe.flow, root: archivedFlow(recipe.flow.root) },
	ingredients: recipe.ingredients.map(withReference),
	familyOptions: recipe.familyOptions.map(withReference),
	calculation: {
		nutrients: nutrition.nutrients,
		rows: nutrition.recipes[recipe.id],
		familyRows: nutrition.familyOptions[recipe.id] ?? [],
	},
}));
