// Align canonical ingredient lists and current nutrition snapshots with the
// first appearance of each ingredient in the cooking flow. Historical evidence
// and independent branch order stay unchanged.
import { readFile, writeFile } from "node:fs/promises";
import { validateFlow } from "../trn-logic.mjs";

const file = new URL("../recipes.json", import.meta.url);
const data = JSON.parse(await readFile(file, "utf8"));
const changed = [];
for (const recipe of data.recipes) {
	validateFlow(recipe);
	const ids = new Set();
	function visit(node) {
		if (node.ingredientId) ids.add(node.ingredientId);
		node.children?.forEach(visit);
	}
	visit(recipe.flow.root);
	const byId = new Map(
		recipe.ingredients.map((ingredient) => [ingredient.id, ingredient]),
	);
	const ordered = [...ids].map((id) => byId.get(id));
	if (
		ordered.every(
			(ingredient, index) => ingredient === recipe.ingredients[index],
		)
	)
		continue;
	changed.push(recipe.id);
	recipe.ingredients = ordered;
	const estimate =
		recipe.sourceRecipe?.nutritionEstimate ?? recipe.nutritionEstimate;
	if (estimate?.ingredientSnapshot) {
		const snapshots = new Map(
			estimate.ingredientSnapshot.map((row) => [row.id, row]),
		);
		if (
			snapshots.size !== ids.size ||
			[...ids].some((id) => !snapshots.has(id))
		) {
			throw new Error(`Incomplete current nutrition snapshot: ${recipe.id}`);
		}
		estimate.ingredientSnapshot = [...ids].map((id) => snapshots.get(id));
	}
}
if (process.argv.includes("--write")) {
	await writeFile(file, `${JSON.stringify(data, null, "\t")}\n`);
	console.log(`Ordered ingredients in ${changed.length} recipes.`);
} else {
	console.log(
		`${changed.length} recipe ingredient lists differ from cooking-flow order.`,
	);
	process.exitCode = Number(changed.length > 0);
}
