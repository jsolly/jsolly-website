import {
	BASE_SERVINGS,
	mealLeftovers,
	recipeDisclaimer,
} from "./constants.mjs";
import { ingredientText } from "./cooking-notes.mjs";
import { cookingText } from "./cooking-quantities.mjs";
import { ingredientMeasure } from "./ingredient-units.mjs";
import { dailyNutrition } from "./nutrition.mjs";
import {
	capacityNote,
	dietaryClass,
	displayNutrition,
	formatIngredient,
	formatQuantity,
	ingredientAmount,
	nutritionHeading,
	nutritionPortionLabel,
	purchaseNote,
	selectedSide,
	sideNutrition,
	smoothieYieldNote,
	totalTimeLabel,
} from "./recipe-logic.mjs";
import {
	formatNutrition,
	UNIT_LABELS,
	validateSettings,
} from "./recipe-settings.mjs";
import { flowGrid, gridHtml } from "./trn-logic.mjs";

/** One cooking document drives Markdown and JSON assistant exports. Model weights stay in recipes.json. */
export function recipeDocument(recipe, settings = {}) {
	const smoothie = recipe.type === "smoothie";
	const valid = validateSettings(settings);
	const { servings, units } = valid;
	const option =
		valid.familyDiners > 0
			? selectedSide(recipe, settings.familyChoice?.[recipe.id])
			: undefined;
	const sideDiners = option ? valid.familyDiners : 0;
	const text = (value) => cookingText(recipe, value, valid);
	const grid = flowGrid(recipe, {
		...valid,
		familyChoice: option ? { [recipe.id]: option.id } : {},
	});
	const ingredients = recipe.ingredients.map((i) => {
		const measured = ingredientMeasure(
			i,
			ingredientAmount(i, servings),
			units,
			formatQuantity,
		);
		return {
			...measured,
			...(measured.alternatives
				? {
						alternatives: measured.alternatives.map((choice) => ({
							...choice,
							name: ingredientText(choice.name),
						})),
					}
				: {}),
			name: ingredientText(i.name),
			state: ingredientText(text(i.state)),
			note: ingredientText(
				text([i.note, purchaseNote(i, servings)].filter(Boolean).join(" · ")),
			),
		};
	});
	const sideIngredient =
		option && sideDiners > 0
			? {
					...ingredientMeasure(
						option,
						option.amount * sideDiners,
						units,
						formatQuantity,
					),
					name: ingredientText(option.ingredientName),
					state: ingredientText(text(option.state)),
					note: ingredientText(text(option.note)),
					choiceId: option.id,
				}
			: null;
	return {
		dailyNutrition: dailyNutrition(recipe, servings, ingredientAmount),
		recipeId: recipe.id,
		type: recipe.type,
		title: recipe.title,
		dietaryClassification: dietaryClass(recipe),
		servings,
		units,
		sideDiners,
		cookingFlow: {
			notation: "Tabular Recipe Notation (TRN)",
			prep: grid.prep,
			columns: grid.columns,
			rows: grid.rows.map((r) => r.cells),
		},
		summary: recipe.summary,
		sharedTable: text(recipe.sharedTable),
		activeMinutes: recipe.activeMinutes,
		portionLabel: recipe.sourceRecipe ? "portions" : "adult servings",
		timeBasis: recipe.sourceRecipe
			? "publisher preparation"
			: "active per base batch",
		sourceRecipe: recipe.sourceRecipe
			? // Snapshot canonical JSON metadata, including Svelte reactive proxies.
				JSON.parse(JSON.stringify(recipe.sourceRecipe))
			: null,
		totalTime: totalTimeLabel(recipe, servings),
		attentionSummary: recipe.attentionSummary,
		capacity: text(smoothie ? recipe.capacity : capacityNote(servings)),
		timingNote: smoothie
			? recipe.timingNote
			: "Ingredients are scaled; keep food thickness, spacing, settings and safe endpoints fixed. Timings assume the four-serving batch and specified shortcuts. More food can require additional batches.",
		equipment: recipe.equipment.map(text),
		ingredients,
		sideIngredient,
		sideOptions: recipe.familyOptions.map((o) => ({
			choiceId: o.id,
			label: o.label,
			quantityPerPerson: formatIngredient(
				{ ...o, scale: "fixed" },
				BASE_SERVINGS,
				units,
			),
			name: ingredientText(o.ingredientName),
			state: ingredientText(text(o.state)),
			note: ingredientText(text(o.note)),
			nutritionAddedPerPerson: sideNutrition(recipe, o.id),
			allergens: [...(o.allergens || [])],
		})),
		steps: recipe.steps.map((s) => ({ title: s.title, text: text(s.text) })),
		timeline: recipe.timeline.map((e) => ({
			phase: e.phase,
			duration: text(e.duration),
			attention: text(e.attention),
		})),
		tips: recipe.tips.map(text),
		fallback: text(recipe.fallback),
		limitations: recipe.limitations.map(text),
		sources: recipe.sources.map((s) => ({ ...s })),
		nutrition: displayNutrition(recipe, servings),
		nutritionHeading: nutritionHeading(recipe),
		nutritionPortionLabel: nutritionPortionLabel(recipe, servings),
		nutritionModel: {
			fatBasis:
				"Ingredient total fat observations at measured edible weights; no calorie residual inference.",
			fatSources: [
				...new Set(
					(recipe.calculation?.rows ?? []).map(
						(row) => row.nutrientSources?.fat ?? row.source,
					),
				),
			],
			fatAssumptions: (recipe.calculation?.rows ?? [])
				.filter((row) => row.fatReview)
				.map((row) => ({ ingredientId: row.ingredientId, ...row.fatReview })),
		},
		sideNutritionPerDiner:
			option && sideDiners > 0 ? sideNutrition(recipe, option.id) : null,
		nutritionNote: recipe.sourceRecipe
			? recipe.sourceRecipe.nutritionBasis
			: `${smoothie ? `${smoothieYieldNote(recipe, servings)} ${recipe.yieldEstimateNote} ` : ""}Per ${smoothie ? "estimated glass" : "adult"}: base includes measured sauces, seeds and sides. Optional side nutrition is separate from the base meal. US net carbs = total carbohydrate − fiber − documented erythritol. Labels and food variation matter; no guarantee of ketosis.`,
		allergens: [
			...new Set([...recipe.allergens, ...(option?.allergens || [])]),
		],
		flavorRationale: recipe.flavorRationale,
		disclaimer: recipeDisclaimer,
		leftovers: text(
			recipe.leftovers ??
				(smoothie
					? "Serve chilled immediately for best texture; refrigerate any remainder promptly."
					: mealLeftovers),
		),
		safety:
			recipe.safety ||
			(smoothie
				? "Wash fresh produce and use a clean blender. Keep yogurt and finished smoothies chilled."
				: "Prepare cold sides first. Keep raw-poultry tools separate; use clean serving utensils. Probe more than one thick piece. A timer is not a doneness test."),
		image: recipe.image ? { ...recipe.image } : null,
	};
}
const HEADING_MARKS = /^(?<marks>#{1,6}) /gmu;
const nutritionSummary = (n) =>
	`Calories: ${formatNutrition(n.kcal, "kcal")}; protein: ${formatNutrition(n.protein_g, "g", 1)}; fat: ${formatNutrition(n.fat_g, "g", 1)}; total carbs: ${formatNutrition(n.carbs_g, "g", 1)}; fiber: ${formatNutrition(n.fiber_g, "g", 1)}; net carbs: ${formatNutrition(n.net_carbs_g, "g", 1)}`;
export function documentMarkdown(d, headingLevel = 1) {
	const lines = [
		`# ${d.title}`,
		`${d.servings} ${d.portionLabel} · ${UNIT_LABELS[d.units]} measures · ${d.dietaryClassification} · ${Number.isFinite(d.activeMinutes) ? `${d.activeMinutes} min ${d.timeBasis}` : "Preparation time not provided"} · ${d.totalTime}`,
		d.summary,
		d.attentionSummary,
		d.capacity,
		d.timingNote,
		"## Cooking flow (Tabular Recipe Notation)",
		gridHtml(d.title, {
			...d.cookingFlow,
			rows: d.cookingFlow.rows.map((cells) => ({ cells })),
		}),
		"## Ingredients",
		...d.ingredients.map(
			(i) =>
				`- ${i.quantity} ${i.name}${(i.alternatives || []).map((choice) => ` or ${choice.quantity} ${choice.name}`).join("")}${i.state ? ` — ${i.state}` : ""}${i.note ? `. ${i.note}` : ""}`,
		),
	];
	if (d.sideIngredient)
		lines.push(
			`## Optional side for ${d.sideDiners} diners`,
			`${d.sideIngredient.quantity} ${d.sideIngredient.name} — ${d.sideIngredient.state}. ${d.sideIngredient.note}`,
		);
	if (d.sideOptions.length)
		lines.push(
			"## Optional side choices (per diner)",
			...d.sideOptions.map(
				(o) =>
					`- ${o.label}: ${o.quantityPerPerson} ${o.name} — ${o.state}. ${o.note}`,
			),
		);
	lines.push(
		"## Equipment",
		...d.equipment.map((x) => `- ${x}`),
		"## Cook",
		d.safety,
		...d.steps.map((s, i) => `${i + 1}. **${s.title}.** ${s.text}`),
		"## For a shared table",
		d.sharedTable,
		"## Attention timeline",
		...d.timeline.map((e) => `- ${e.phase}: ${e.duration}. ${e.attention}`),
		"Stages can overlap; endpoints and appliance behavior override the estimate.",
		"## Flavor and capacity",
		d.flavorRationale,
		...d.tips.map((t) => `- ${t}`),
		d.fallback,
		`## ${d.nutritionHeading}`,
		d.nutritionPortionLabel,
		nutritionSummary(d.nutrition),
	);
	if (d.sideNutritionPerDiner)
		lines.push(
			`Selected optional side only, per diner: ${nutritionSummary(d.sideNutritionPerDiner)}`,
		);
	lines.push(
		d.nutritionNote,
		`Fat estimate: ${d.nutritionModel.fatBasis}`,
		...d.nutritionModel.fatAssumptions.map((assumption) => assumption.basis),
		...(d.sourceRecipe?.nutritionEstimate
			? [
					"Nutrition assumptions:",
					...d.sourceRecipe.nutritionEstimate.assumptions.map(
						(assumption) => `- ${assumption}`,
					),
				]
			: []),
		`Known allergens for these plates: ${d.allergens.join(", ") || "none listed; check every product label"}. Check product labels and cross-contact.`,
		"## First-cook checks and limits",
		...d.limitations.map((x) => `- ${x}`),
		"## Leftovers",
		d.leftovers,
		"## Sources",
		...d.sources.map((s) => `- [${s.title}](${s.url})`),
		d.sourceRecipe?.resolvedUrl &&
			!d.sources.some((source) => source.url === d.sourceRecipe.resolvedUrl)
			? `- [Resolved publisher source](${d.sourceRecipe.resolvedUrl})`
			: "",
		d.disclaimer,
	);
	const body = lines
		.filter(Boolean)
		.map((line) =>
			line.replace(
				HEADING_MARKS,
				(_, marks) => `${"#".repeat(marks.length + headingLevel - 1)} `,
			),
		)
		.join("\n\n");
	return `${body}\n`;
}
export function recipeBundle(recipes, settings = {}) {
	return {
		schemaVersion: 2,
		baseServings: BASE_SERVINGS,
		settings: validateSettings(settings),
		disclaimer: recipeDisclaimer,
		recipes: recipes.map((r) => recipeDocument(r, settings)),
	};
}
