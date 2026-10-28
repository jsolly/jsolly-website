/**
 * Apply the reviewed, explicit measurement decisions to the original library.
 * No food matching, nutrition-weight inference, network lookup or defaults run here.
 * Each baseline identity is consumed once; split rows inherit the original leaf's
 * allocation. A completed migration is idempotent and preserves later recipe edits.
 */
import { readFileSync, writeFileSync } from "node:fs";

const recipePath = new URL(
	"../../src/components/recipes/recipes.json",
	import.meta.url,
);
const decisionPath = new URL("./measurement-decisions.json", import.meta.url);
const data = JSON.parse(readFileSync(recipePath, "utf8"));
const mapping = JSON.parse(readFileSync(decisionPath, "utf8"));
const marker = "reviewed-measurements-2026-10-15";
const migrationFields = [
	"weightRef",
	"alternatives",
	"pinchGrams",
	"us",
	"gramsPerUnit",
	"massSource",
	"amountMax",
];
const mappingByRecipe = new Map();
const reviewedIdentities = new Set();
for (const decision of mapping.decisions) {
	const identity = `${decision.recipeId}/${decision.family ? "family" : "ingredient"}/${decision.ingredientId}`;
	if (reviewedIdentities.has(identity))
		throw new Error(`Duplicate reviewed identity: ${identity}`);
	reviewedIdentities.add(identity);
	if (
		decision.original.amount > 0 &&
		["g", "oz", "lb"].includes(decision.original.unit)
	) {
		const primary = decision.rows[0];
		if (
			primary.amount !== decision.original.amount ||
			primary.unit !== decision.original.unit
		) {
			throw new Error(`Reviewed mass quantity changed: ${identity}`);
		}
	}
	const entries = mappingByRecipe.get(decision.recipeId) ?? [];
	entries.push(decision);
	mappingByRecipe.set(decision.recipeId, entries);
}
if (reviewedIdentities.size !== mapping.baselineEntries)
	throw new Error("Reviewed decision count does not match the baseline");
function assertPositive(row, context) {
	if (!Number.isFinite(row.amount) || row.amount <= 0) {
		throw new Error(`${context}: missing positive measured quantity`);
	}
}
function verify() {
	const identities = new Set();
	for (const recipe of data.recipes) {
		for (const [kind, rows] of [
			["ingredient", recipe.ingredients],
			["family", recipe.familyOptions],
		]) {
			for (const row of rows) {
				assertPositive(row, `${recipe.id}/${row.id}`);
				const originalId = row.measurementProvenance?.sourceIngredientId;
				if (!originalId)
					throw new Error(`${recipe.id}/${row.id}: missing original identity`);
				const identity = `${recipe.id}/${kind}/${originalId}`;
				if (!reviewedIdentities.has(identity))
					throw new Error(`Unreviewed original identity: ${identity}`);
				identities.add(identity);
				for (const alternate of row.alternatives ?? [])
					assertPositive(alternate, `${recipe.id}/${row.id}/${alternate.name}`);
			}
		}
	}
	if (identities.size !== mapping.baselineEntries)
		throw new Error(
			`Expected ${mapping.baselineEntries} original entries; found ${identities.size}`,
		);
}
if (data.measurementMigration === marker) {
	verify();
	console.log(
		`Measurement migration already applied; ${mapping.baselineEntries} original entries verified.`,
	);
} else {
	let consumed = 0;
	for (const recipe of data.recipes) {
		const splits = new Map();
		for (const decision of mappingByRecipe.get(recipe.id) ?? []) {
			const field = decision.family ? "familyOptions" : "ingredients";
			const index = recipe[field].findIndex(
				(row) => row.id === decision.ingredientId,
			);
			if (index < 0)
				throw new Error(`Missing ${recipe.id}/${decision.ingredientId}`);
			const original = recipe[field][index];
			if (
				original.amount !== decision.original.amount ||
				original.unit !== decision.original.unit
			)
				throw new Error(
					`Unreviewed source quantity drift: ${recipe.id}/${original.id}`,
				);
			const rows = decision.rows.map((patch) => {
				const row = { ...original };
				for (const key of migrationFields) delete row[key];
				// nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- Offline authoring migration reads reviewed repository decisions, not network or request data.
				Object.assign(row, patch);
				assertPositive(row, `${recipe.id}/${row.id}`);
				return row;
			});
			recipe[field].splice(index, 1, ...rows);
			if (rows.length > 1)
				splits.set(
					original.id,
					rows.map((row) => row.id),
				);
			consumed++;
		}
		function expand(node) {
			if (!node || typeof node !== "object") return node;
			if (node.children)
				node.children = node.children.flatMap((child) => {
					if (child.ingredientId && splits.has(child.ingredientId))
						return splits
							.get(child.ingredientId)
							.map((id) => ({ ...child, ingredientId: id }));
					return [expand(child)];
				});
			return node;
		}
		if (recipe.flow?.root) recipe.flow.root = expand(recipe.flow.root);
		if (recipe.id === "source-creamy-fajita-chicken-breasts-skillet") {
			function assign(node) {
				if (!node?.children) return;
				node.children = node.children.filter(
					(child) => child.ingredientId !== "ingredient-6",
				);
				for (const child of node.children) assign(child);
				const directIds = node.children.map((child) => child.ingredientId);
				if (directIds.includes("ingredient-1"))
					node.children.push({
						ingredientId: "ingredient-6",
						fraction: 3 / 28,
					});
				if (
					directIds.includes("ingredient-2") &&
					directIds.includes("ingredient-3")
				)
					node.children.push({
						ingredientId: "ingredient-6",
						fraction: 25 / 28,
					});
			}
			assign(recipe.flow.root);
		}
	}
	if (consumed !== mapping.baselineEntries)
		throw new Error(
			`Consumed ${consumed} decisions, expected ${mapping.baselineEntries}`,
		);
	data.measurementMigration = marker;
	verify();
	writeFileSync(recipePath, `${JSON.stringify(data, null, "\t")}\n`);
	console.log(`Applied ${consumed} reviewed measurement decisions.`);
}
