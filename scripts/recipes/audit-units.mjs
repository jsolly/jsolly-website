import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	ingredientMeasure,
	ingredientWeight,
	UNIT_LABELS,
} from "../../src/components/recipes/ingredient-units.mjs";
import { formatQuantity } from "../../src/components/recipes/recipe-logic.mjs";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};

const output = new URL("../../docs/recipe-units-audit.json", import.meta.url);
export function unitAudit() {
	const rows = data.recipes.flatMap((recipe) =>
		[
			...recipe.ingredients.map((ingredient) => ({
				recipe: recipe.id,
				family: false,
				ingredient,
			})),
			...recipe.familyOptions.map((ingredient) => ({
				recipe: recipe.id,
				family: true,
				ingredient,
			})),
		].map(({ ingredient, ...identity }) => ({
			...identity,
			ingredient: ingredient.id,
			name: ingredient.name || ingredient.ingredientName,
			canonical: {
				amount: ingredient.amount,
				unit: ingredient.unit,
				state: ingredient.state,
			},
			weight: ingredientWeight(ingredient),
			displays: Object.fromEntries(
				Object.keys(UNIT_LABELS).map((units) => [
					units,
					ingredientMeasure(
						ingredient,
						ingredient.amount,
						units,
						formatQuantity,
					),
				]),
			),
		})),
	);
	const summary = Object.fromEntries(
		Object.keys(UNIT_LABELS).map((units) => [
			units,
			Object.fromEntries(
				[...new Set(rows.map((row) => row.displays[units].status))]
					.sort()
					.map((status) => [
						status,
						rows.filter((row) => row.displays[units].status === status).length,
					]),
			),
		]),
	);
	return `${JSON.stringify({ recipeCount: data.recipes.length, ingredientCount: rows.length, summary, rows }, null, "\t")}\n`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const expected = unitAudit();
	if (process.argv.includes("--write")) await writeFile(output, expected);
	else if ((await readFile(output, "utf8")) !== expected)
		throw new Error(
			"Stale recipe unit audit. Run node scripts/recipes/audit-units.mjs --write.",
		);
}
