import {
	BASE_SERVINGS,
	mealLeftovers,
	recipeDisclaimer,
} from "./constants.mjs";
import { cookText } from "./display-units.mjs";
import {
	ingredientMeasure,
	MEASUREMENT_POLICY,
	UNIT_LABELS,
} from "./ingredient-units.mjs";
import { dailyNutrition } from "./nutrition.mjs";
import {
	capacityNote,
	displayNutrition,
	familyNutrition,
	formatIngredient,
	formatNutrition,
	formatQuantity,
	ingredientAmount,
	nutritionHeading,
	purchaseNote,
	smoothieYieldNote,
	totalTimeLabel,
	validateSettings,
} from "./recipe-logic.mjs";
import { flowGrid, gridHtml } from "./trn-logic.mjs";

/** One cooking document drives Markdown and JSON assistant exports. Model weights stay in recipes.json. */
export function recipeDocument(recipe, settings = {}) {
	const smoothie = recipe.type === "smoothie";
	const valid = validateSettings(settings);
	const { servings, units } = valid;
	const familyDiners = recipe.group === "shared" ? valid.familyDiners : 0;
	const option =
		familyDiners > 0
			? recipe.familyOptions.find(
					(o) => o.id === settings.familyChoice?.[recipe.id],
				) || recipe.familyOptions[0]
			: null;
	const text = (value) => cookText(value || "", units);
	const grid = flowGrid(recipe, valid);
	const ingredients = recipe.ingredients.map((i) => ({
		...ingredientMeasure(
			i,
			ingredientAmount(i, servings),
			units,
			formatQuantity,
		),
		name: i.name,
		state: text(i.state),
		note: text([i.note, purchaseNote(i, servings)].filter(Boolean).join(" · ")),
	}));
	const familyIngredient = option
		? {
				quantity: formatIngredient(
					{
						...option,
						amount: option.amount * familyDiners,
						scale: "fixed",
					},
					BASE_SERVINGS,
					units,
				),
				name: option.ingredientName,
				state: text(option.state),
				note: text(option.note),
				choiceId: option.id,
			}
		: null;
	return {
		dailyNutrition: dailyNutrition(recipe, servings, ingredientAmount),
		recipeId: recipe.id,
		type: recipe.type,
		title: recipe.title,
		group: recipe.group,
		servings,
		units,
		measurementPolicy: MEASUREMENT_POLICY,
		familyDiners,
		cookingFlow: {
			notation: "Tabular Recipe Notation (TRN)",
			prep: grid.prep,
			columns: grid.columns,
			rows: grid.rows.map((r) => r.cells),
		},
		summary: recipe.summary,
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
		familyIngredient,
		familyOptions: recipe.familyOptions.map((o) => ({
			choiceId: o.id,
			label: o.label,
			quantityPerPerson: formatIngredient(
				{ ...o, scale: "fixed" },
				BASE_SERVINGS,
				units,
			),
			name: o.ingredientName,
			state: text(o.state),
			note: text(o.note),
			nutritionAddedPerPerson: { ...o.nutrition },
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
		familyNutrition: option
			? familyNutrition(recipe, option.id, servings)
			: null,
		nutritionNote: recipe.sourceRecipe
			? recipe.sourceRecipe.nutritionBasis
			: `${smoothie ? `${smoothieYieldNote(recipe, servings)} ${recipe.yieldEstimateNote} ` : ""}Per ${smoothie ? "estimated glass" : "adult"}: base includes measured sauces, seeds and sides. Family nutrition adds one selected starch portion. US net carbs = total carbohydrate − fiber. Labels and food variation matter; no guarantee of ketosis.`,
		allergens: [
			...new Set([...recipe.allergens, ...(option?.allergens || [])]),
		],
		flavorRationale: recipe.flavorRationale,
		disclaimer: recipeDisclaimer,
		leftovers: text(
			smoothie
				? "Serve chilled immediately for best texture; refrigerate any remainder promptly."
				: mealLeftovers,
		),
		safety: smoothie
			? "Wash fresh produce and use a clean blender. Keep yogurt and finished smoothies chilled."
			: "Prepare cold sides first. Keep raw-poultry tools separate; use clean serving utensils. Probe more than one thick piece. A timer is not a doneness test.",
		image: recipe.image ? { ...recipe.image } : null,
	};
}
const HEADING_MARKS = /^(?<marks>#{1,6}) /gmu;
const nutritionSummary = (n) =>
	`Calories: ${formatNutrition(n.kcal, "kcal")}; protein: ${formatNutrition(n.protein_g, "g", 1)}; total carbs: ${formatNutrition(n.carbs_g, "g", 1)}; fiber: ${formatNutrition(n.fiber_g, "g", 1)}; net carbs: ${formatNutrition(n.net_carbs_g, "g", 1)}`;
export function documentMarkdown(d, headingLevel = 1) {
	const lines = [
		`# ${d.title}`,
		`${d.servings} ${d.portionLabel} · ${UNIT_LABELS[d.units]} measures · ${d.group} · ${Number.isFinite(d.activeMinutes) ? `${d.activeMinutes} min ${d.timeBasis}` : "Preparation time not provided"} · ${d.totalTime}`,
		d.summary,
		d.attentionSummary,
		d.capacity,
		d.timingNote,
		d.measurementPolicy,
		"## Cooking flow (Tabular Recipe Notation)",
		gridHtml(d.title, {
			...d.cookingFlow,
			rows: d.cookingFlow.rows.map((cells) => ({ cells })),
		}),
		"## Ingredients",
		...d.ingredients.map(
			(i) =>
				`- ${i.quantity} ${i.name}${i.state ? ` — ${i.state}` : ""}${i.note ? `. ${i.note}` : ""}`,
		),
	];
	if (d.familyIngredient)
		lines.push(
			`## Separate family starch for ${d.familyDiners} diners`,
			`${d.familyIngredient.quantity} ${d.familyIngredient.name} — ${d.familyIngredient.state}. ${d.familyIngredient.note}`,
		);
	if (d.familyOptions.length)
		lines.push(
			"## Family starch options (per non-keto adult)",
			...d.familyOptions.map(
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
		"## Attention timeline",
		...d.timeline.map((e) => `- ${e.phase}: ${e.duration}. ${e.attention}`),
		"Stages can overlap; endpoints and appliance behavior override the estimate.",
		"## Flavor and capacity",
		d.flavorRationale,
		...d.tips.map((t) => `- ${t}`),
		d.fallback,
		`## ${d.nutritionHeading}`,
		nutritionSummary(d.nutrition),
	);
	if (d.familyNutrition)
		lines.push(
			`With selected family starch: ${nutritionSummary(d.familyNutrition)}`,
		);
	lines.push(
		d.nutritionNote,
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
		schemaVersion: 1,
		baseServings: BASE_SERVINGS,
		settings: validateSettings(settings),
		disclaimer: recipeDisclaimer,
		measurementPolicy: MEASUREMENT_POLICY,
		recipes: recipes.map((r) => recipeDocument(r, settings)),
	};
}
