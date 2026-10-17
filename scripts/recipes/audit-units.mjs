import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	ingredientGrams,
	ingredientMeasure,
	ingredientWeight,
	UNIT_LABELS,
} from "../../src/components/recipes/ingredient-units.mjs";
import weights from "../../src/components/recipes/ingredient-weights.json" with {
	type: "json",
};
import {
	formatQuantity,
	ingredientAmount,
} from "../../src/components/recipes/recipe-logic.mjs";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};

const BAD_DISPLAY =
	/unavailable|unspecified|to taste|NaN|Infinity|undefined|~|\(/u;
const GRAMS = /^[\d.e+-]+ g$/u;
const output = new URL("../../docs/recipe-units-audit.json", import.meta.url);
const SERVINGS = [2, 4, 6, 8];
const positive = (value) => Number.isFinite(value) && value > 0;
const requireEvidence = (condition, identity, message) => {
	if (!condition) throw new Error(`${identity}: ${message}`);
};

function referenceAudit() {
	const ids = new Set();
	for (const ref of weights.references) {
		requireEvidence(
			ref.id && !ids.has(ref.id),
			ref.id,
			"reference id must be unique",
		);
		ids.add(ref.id);
		requireEvidence(
			ref.state && ["edible", "as-purchased", "drained"].includes(ref.basis),
			ref.id,
			"reference needs its preparation state and cooking mass basis",
		);
		requireEvidence(
			["mass", "liquid"].includes(ref.kind),
			ref.id,
			"invalid measurement dimension",
		);
		requireEvidence(
			ref.source &&
				ref.description &&
				ref.provenance?.decision &&
				ref.provenance?.evidence &&
				ref.provenance?.reviewedOn,
			ref.id,
			"reference needs source, food description and review evidence",
		);
		for (const [unit, observation] of Object.entries(ref.measures)) {
			requireEvidence(
				unit &&
					positive(observation.amount) &&
					positive(observation.grams) &&
					observation.portion,
				ref.id,
				`invalid ${unit} observation`,
			);
		}
		if (ref.gramsPerMl !== undefined)
			requireEvidence(
				ref.kind === "liquid" && positive(ref.gramsPerMl),
				ref.id,
				"density belongs only to a supported liquid",
			);
		if (ref.volumeInterpolationUnit)
			requireEvidence(
				ref.measures[ref.volumeInterpolationUnit],
				ref.id,
				"interpolation needs its named observation",
			);
	}
}

function displays(ingredient, amount) {
	return Object.fromEntries(
		Object.keys(UNIT_LABELS).map((units) => {
			const shown = ingredientMeasure(
				ingredient,
				amount,
				units,
				formatQuantity,
			);
			for (const choice of [shown, ...(shown.alternatives || [])]) {
				requireEvidence(
					positive(choice.grams),
					ingredient.id,
					`${units} has no positive cooking mass`,
				);
				requireEvidence(
					!BAD_DISPLAY.test(choice.quantity),
					ingredient.id,
					`${units} contains unresolved conversion prose`,
				);
				if (units === "grams")
					requireEvidence(
						GRAMS.test(choice.quantity),
						ingredient.id,
						"grams mode must use grams only",
					);
			}
			return [units, shown];
		}),
	);
}

/** Complete canonical rows, alternatives, serving scaling and every family-diner count. */
export function unitAudit() {
	referenceAudit();
	const originalIdentities = new Set();
	const rows = data.recipes.flatMap((recipe) => {
		const identities = new Set();
		return [
			...recipe.ingredients.map((ingredient) => ({
				family: false,
				ingredient,
			})),
			...recipe.familyOptions.map((ingredient) => ({
				family: true,
				ingredient,
			})),
		].map(({ ingredient: input, family }) => {
			const ingredient = { ...input, recipeId: recipe.id };
			const identity = `${recipe.id}/${family ? "family" : "ingredient"}/${ingredient.id}`;
			requireEvidence(
				!identities.has(identity),
				identity,
				"duplicate ingredient id",
			);
			identities.add(identity);
			const provenance = ingredient.measurementProvenance;
			requireEvidence(
				provenance?.sourceIngredientId &&
					provenance.original &&
					provenance.decision &&
					provenance.reviewedOn &&
					provenance.massBasis,
				identity,
				"missing source identity or measurement review",
			);
			originalIdentities.add(
				`${recipe.id}/${family ? "family" : "ingredient"}/${provenance.sourceIngredientId}`,
			);
			const weight = ingredientWeight(ingredient);
			const reference = weights.references.find(
				(ref) => ref.id === ingredient.weightRef,
			);
			requireEvidence(
				!reference || reference.basis === provenance.massBasis,
				identity,
				"ingredient cooking mass basis disagrees with its reference",
			);
			const grams = ingredientGrams(ingredient);
			const scaling = Object.fromEntries(
				SERVINGS.map((servings) => [
					servings,
					family
						? Object.fromEntries(
								Array.from({ length: servings }, (_, index) => {
									const diners = index + 1;
									return [
										diners,
										displays(ingredient, ingredient.amount * diners),
									];
								}),
							)
						: displays(ingredient, ingredientAmount(ingredient, servings)),
				]),
			);
			return {
				recipe: recipe.id,
				family,
				ingredient: ingredient.id,
				name: ingredient.name || ingredient.ingredientName,
				canonical: {
					amount: ingredient.amount,
					unit: ingredient.unit,
					state: ingredient.state,
					grams,
				},
				weight,
				provenance,
				alternatives: ingredient.alternatives || [],
				displays: displays(ingredient, ingredient.amount),
				scaling,
			};
		});
	});
	const sourceIdentities = [...originalIdentities].sort();
	const identitySha256 = createHash("sha256")
		.update(JSON.stringify(sourceIdentities))
		.digest("hex");
	return `${JSON.stringify(
		{
			recipeCount: data.recipes.length,
			ingredientCount: rows.length,
			alternativeCount: rows.reduce(
				(sum, row) => sum + row.alternatives.length,
				0,
			),
			sourceIdentityCount: sourceIdentities.length,
			sourceIdentitySha256: identitySha256,
			rows,
		},
		null,
		"\t",
	)}\n`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const expected = unitAudit();
	if (process.argv.includes("--write")) await writeFile(output, expected);
	else if ((await readFile(output, "utf8")) !== expected)
		throw new Error(
			"Stale recipe unit audit. Run node scripts/recipes/audit-units.mjs --write.",
		);
}
