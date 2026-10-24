// Recheck the planning inventory against its frozen pre-migration source data.
// This is a review artifact, not a publication whitelist or recipe migration.
import { readFile, writeFile } from "node:fs/promises";
import data from "../../docs/recipes-archive/keto-2026-10-23/recipes.json" with {
	type: "json",
};
import { KETO_NET_CARBS_MAX } from "../../src/components/recipes/constants.mjs";
import {
	dietaryClass,
	displayNutrition,
} from "../../src/components/recipes/recipe-logic.mjs";

const output = new URL(
	"../../docs/plans/keto-recipes-audit.json",
	import.meta.url,
);
const plan = new URL("../../docs/plans/keto-recipes.md", import.meta.url);
const mode = process.argv[2] ?? "--check";
if (!["--check", "--write"].includes(mode) || process.argv.length > 3)
	throw new Error(
		"Usage: node scripts/recipes/audit-keto-plan.mjs [--check|--write]",
	);

const stored = await readFile(output, "utf8");
const review = JSON.parse(stored);
const byId = new Map(review.recipes.map((recipe) => [recipe.id, recipe]));
if (byId.size !== review.recipes.length || byId.size !== data.recipes.length)
	throw new Error(
		"Planning inventory has duplicate, missing or extra recipe ids.",
	);

const recipes = data.recipes.map((recipe) => {
	const decision = byId.get(recipe.id);
	if (!decision) throw new Error(`${recipe.id}: missing recipe review`);
	const classification = dietaryClass(recipe);
	if (
		!["keep", "adapt", "exclude"].includes(decision.action) ||
		(classification === "keto") !== (decision.action === "keep") ||
		!decision.reason?.trim() ||
		!decision.sharedTable?.trim() ||
		(classification !== "keto" && !decision.ketoChange?.trim())
	)
		throw new Error(
			`${recipe.id}: review needs an explicit, consistent decision`,
		);
	return {
		id: recipe.id,
		title: recipe.title,
		type: recipe.type,
		netCarbsGrams: displayNutrition(recipe).net_carbs_g,
		portion:
			recipe.type === "smoothie"
				? "estimated 8 fl oz glass"
				: "one quarter of the four-serving base recipe",
		classification,
		existingSideOptions: recipe.familyOptions.length,
		action: decision.action,
		reason: decision.reason,
		sharedTable: decision.sharedTable,
		...(decision.ketoChange ? { ketoChange: decision.ketoChange } : {}),
	};
});
const count = (predicate) => recipes.filter(predicate).length;
const result = {
	reviewedOn: review.reviewedOn,
	baselineCommit: review.baselineCommit,
	ketoNetCarbsMaximum: KETO_NET_CARBS_MAX,
	status:
		"Planning only. Adaptations require recipe and nutrition review before publication.",
	counts: {
		recipes: recipes.length,
		ketoMeals: count(
			(recipe) => recipe.type === "meal" && recipe.classification === "keto",
		),
		ketoSmoothies: count(
			(recipe) =>
				recipe.type === "smoothie" && recipe.classification === "keto",
		),
		nonKetoMeals: count(
			(recipe) => recipe.type === "meal" && recipe.classification !== "keto",
		),
		nonKetoSmoothies: count(
			(recipe) =>
				recipe.type === "smoothie" && recipe.classification !== "keto",
		),
		withExistingSideOptions: count((recipe) => recipe.existingSideOptions > 0),
		keep: count((recipe) => recipe.action === "keep"),
		adapt: count((recipe) => recipe.action === "adapt"),
		exclude: count((recipe) => recipe.action === "exclude"),
	},
	recipes,
};
const expected = `${JSON.stringify(result, null, "\t")}\n`;
const planText = await readFile(plan, "utf8");
const start = "<!-- recipe-audit:start -->";
const end = "<!-- recipe-audit:end -->";
if (planText.split(start).length !== 2 || planText.split(end).length !== 2)
	throw new Error("Plan needs exactly one recipe audit section.");
const cell = (value) =>
	String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const table = [
	"| Recipe | Net carbs | Action | Shared-table suggestion |",
	"| --- | ---: | --- | --- |",
	...recipes.map(
		(recipe) =>
			`| ${cell(recipe.title)} | ${recipe.netCarbsGrams.toFixed(2)} g | ${recipe.action} | ${cell(recipe.sharedTable)} |`,
	),
].join("\n");
const expectedPlan = planText.replace(
	/<!-- recipe-audit:start -->[\s\S]*?<!-- recipe-audit:end -->/u,
	`${start}\n\n${table}\n\n${end}`,
);
if (mode === "--write") {
	await writeFile(output, expected);
	await writeFile(plan, expectedPlan);
} else if (stored !== expected || planText !== expectedPlan)
	throw new Error(
		"Planning inventory is stale. Review changed recipes, then rerun with --write.",
	);
console.log(JSON.stringify(result.counts));
