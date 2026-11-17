// Remove plain added salt from current recipes, leaving publisher evidence and
// compound ingredients such as garlic salt intact. Safe to rerun after editing.
// Run with --write to apply; without it, check that the migration is complete.
import { readFile, writeFile } from "node:fs/promises";
import { validateFlow } from "../trn-logic.mjs";
import { reconcileMacros } from "./reconcile-nutrition.mjs";

const recipeFile = new URL("../recipes.json", import.meta.url);
const nutritionFile = new URL("../nutrition-data.json", import.meta.url);
const recipes = JSON.parse(await readFile(recipeFile, "utf8"));
const nutrition = JSON.parse(await readFile(nutritionFile, "utf8"));
const before = JSON.stringify({ recipes, nutrition });
const saltAssumption =
	/^(?:fine(?: grain)? sea salt|fine salt|salt|Morton coarse kosher salt)\b/iu;
const plainSalt =
	/^(?:(?:fine(?: grain)? sea|fine|Morton coarse kosher) )?salt$/iu;

function wording(text) {
	return text
		.replaceAll("garlic salt", "GARLIC_BLEND")
		.replaceAll("seasoning salt", "SEASONING_BLEND")
		.replace(/salt-and-pepper/giu, "pepper")
		.replace(/Salt\/pepper/gu, "Pepper")
		.replace(/salt\/pepper/gu, "pepper")
		.replace(
			/,? and (?:half the remaining|one third of the|half the) salt\b/giu,
			"",
		)
		.replace(/, a pinch of salt and /gu, " and ")
		.replace(/ with (?:a little of the measured|pinch of) salt\b/giu, "")
		.replace(/, first salt portion and /gu, " and ")
		.replace(/, salt and /gu, " and ")
		.replace(/, salt, /gu, ", ")
		.replace(/\bsalt\s+and\s+/giu, "")
		.replace(/\bsalt, /giu, "")
		.replace(/,? and salt\b/giu, "")
		.replaceAll(
			"half the oil, half the garlic.",
			"half the oil and half the garlic.",
		)
		.replaceAll("oil, garlic.", "oil and garlic.")
		.replaceAll("oil, and pepper.", "oil and pepper.")
		.replaceAll("Mix oil, spices.", "Mix oil and spices.")
		.replaceAll("ginger and plus", "ginger, plus")
		.replaceAll("remaining the pepper", "pepper")
		.replaceAll("with its pepper portions", "with its pepper portion")
		.replaceAll("and their pepper portions", "and their pepper portion")
		.replaceAll("omits all three", "omits both")
		.replaceAll(
			"The pepper shown in the preparation branch are totals",
			"The pepper shown in the preparation branch is the total",
		)
		.replaceAll("combined pepper seasoning", "pepper")
		.replaceAll("combined pepper amount", "pepper amount")
		.replaceAll("basil, remaining oil.", "basil and remaining oil.")
		.replaceAll("Italian seasoning, pepper;", "Italian seasoning and pepper;")
		.replaceAll(
			"Combined pepper quantity is ambiguous separately.",
			"The source does not specify a separate pepper quantity.",
		)
		.replaceAll("GARLIC_BLEND", "garlic salt")
		.replaceAll("SEASONING_BLEND", "seasoning salt");
}

// These source notes become obsolete when the discretionary ingredient is omitted.
const obsolete =
	/^(?:Salt is to taste:|The publisher specifies one teaspoon of salt)|Zucchini may release water.*salting/u;
function clean(value) {
	if (typeof value === "string") return wording(value);
	if (Array.isArray(value)) {
		return value
			.filter((item) => typeof item !== "string" || !obsolete.test(item))
			.map(clean);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, clean(item)]),
		);
	}
	return value;
}

let removed = 0;
for (const recipe of recipes.recipes) {
	const ids = new Set(
		recipe.ingredients.filter((i) => plainSalt.test(i.name)).map((i) => i.id),
	);
	removed += ids.size;
	recipe.ingredients = recipe.ingredients.filter((i) => !ids.has(i.id));
	function prune(node) {
		if (node.ingredientId) return ids.has(node.ingredientId) ? null : node;
		node.children = node.children.map(prune).filter(Boolean);
		if (!node.children.length)
			throw new Error(`Empty cooking operation: ${recipe.id}`);
		return node;
	}
	prune(recipe.flow.root);
	for (const key of [
		"steps",
		"flow",
		"tips",
		"limitations",
		"fallback",
		"summary",
		"timeline",
		"attentionSummary",
		"flavorRationale",
		"sharedTable",
		"familyOptions",
	]) {
		if (recipe[key] !== undefined) recipe[key] = clean(recipe[key]);
	}
	// Keep ingredient measurement provenance, publisher source lines and historical
	// estimates byte-equivalent. Only the current model and snapshot change.
	if (ids.size) {
		const rows = nutrition.recipes[recipe.id];
		nutrition.recipes[recipe.id] = rows.filter(
			(row) => !ids.has(row.ingredientId),
		);
		const estimate =
			recipe.sourceRecipe?.nutritionEstimate ?? recipe.nutritionEstimate;
		estimate.ingredientSnapshot = estimate.ingredientSnapshot.filter(
			(row) => !ids.has(row.id),
		);
		if (estimate.assumptions)
			estimate.assumptions = estimate.assumptions.filter(
				(note) => !saltAssumption.test(note),
			);
		const changedMacros = rows.some(
			(row) =>
				ids.has(row.ingredientId) &&
				Object.values(row.macros).some((amount) => amount > 0),
		);
		if (changedMacros)
			reconcileMacros(
				recipe,
				nutrition.recipes[recipe.id],
				recipes.baseServings,
			);
	}
	validateFlow(recipe);
}

const changed = before !== JSON.stringify({ recipes, nutrition });
if (process.argv.includes("--write")) {
	await writeFile(recipeFile, `${JSON.stringify(recipes, null, "\t")}\n`);
	await writeFile(nutritionFile, `${JSON.stringify(nutrition, null, "\t")}\n`);
	console.log(`Removed ${removed} plain salt ingredient rows.`);
} else {
	if (changed)
		throw new Error("Run remove-salt.mjs --write, then npm run recipes:sync");
	console.log(
		"Current recipes omit plain added salt; cooking allocations are valid.",
	);
}
