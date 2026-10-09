<script>
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import { BASE_SERVINGS } from "./constants.mjs";
	import NutrientDisclosure from "./NutrientDisclosure.svelte";
	import { dailyNutrition } from "./nutrition.mjs";
	import RecipeFlow from "./RecipeFlow.svelte";
	import {
		displayNutrition,
		formatIngredient,
		formatNutrition,
		ingredientAmount,
		nutritionHeading,
	totalTimeLabel,
	} from "./recipe-logic.mjs";

	// A recipe's appliances, facts, photo, family side, cooking flow and
	// nutrition, shared by the recipe page and the library's recipe dialog.
	let {
		recipe,
		settings,
		interactive = true,
		headingLevel = 3,
		onSideChange,
	} = $props();
	const sideId = $props.id();
	const selectedSide = $derived(
		settings.familyChoice[recipe.id] || recipe.familyOptions[0]?.id || "",
	);
	const baseNutrition = $derived(displayNutrition(recipe, settings.servings));
	const dailyValues = $derived(
		dailyNutrition(recipe, settings.servings, ingredientAmount).filter(
			(nutrient) => nutrient.amount !== null,
		),
	);
	const side = $derived(
		recipe.familyOptions.find((option) => option.id === selectedSide) ||
			recipe.familyOptions[0],
	);
	// The family side is a fixed amount per diner, whatever the servings.
	const sideAmount = $derived(
		side &&
			formatIngredient(
				{
					...side,
					amount: side.amount * settings.familyDiners,
					us: side.us
						? { ...side.us, amount: side.us.amount * settings.familyDiners }
						: undefined,
					scale: "fixed",
				},
				BASE_SERVINGS,
				settings.units,
			),
	);
</script>

<div class="recipe-body">
	{#if recipe.sourceRecipe}<p class="source-credit">Adapted from <a href={recipe.sourceRecipe.resolvedUrl || recipe.sourceRecipe.url}>{recipe.sourceRecipe.author || "the original publisher"}</a>. {recipe.sourceRecipe.nutritionBasis}</p>{/if}
	<div class="detail-appliances">
		<span>Appliances needed</span>
		<div class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name} />{/each}</div>
	</div>
	<div class="detail-facts">
		<span><strong>{recipe.activeMinutes === null ? "Not provided" : `${recipe.activeMinutes}${settings.servings > BASE_SERVINGS ? "+" : ""} min`}</strong> {recipe.sourceRecipe ? "prep time (publisher)" : "active time"}{settings.servings > BASE_SERVINGS ? " / base batch" : ""}</span>
		<span><strong>{settings.servings}</strong> servings</span>
		<span><strong>{totalTimeLabel(recipe, settings.servings)}</strong> total time</span>
	</div>
	{#if recipe.image}
		<figure class="recipe-photo">
			<img src={recipe.image.src} srcset={recipe.image.detailSrcset} sizes="(max-width:600px) 320px, (max-width:1000px) 680px, 960px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="eager" decoding="async" /><figcaption>{recipe.image.caption}</figcaption>
		</figure>
	{/if}
	{#if side}
		<div class="family-box">
			<label for={sideId}
				>Family side<NativeSelect id={sideId} value={selectedSide} disabled={!interactive} onchange={(event) => onSideChange?.(event.currentTarget.value)}>
					{#each recipe.familyOptions as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
				</NativeSelect></label
			>
			<p>{sideAmount} {side.ingredientName} · serve separately</p>
		</div>
	{/if}
	{#if recipe.sourceRecipe}<section aria-label="Source notes"><svelte:element this={`h${headingLevel}`}>Before cooking</svelte:element><ul>{#each recipe.limitations as note, index (index)}<li>{note}</li>{/each}</ul></section>{/if}
	{#key recipe.id}<RecipeFlow {recipe} {settings} {interactive} {headingLevel} />{/key}
	{#if recipe.sourceRecipe}<section aria-label="Recipe method"><svelte:element this={`h${headingLevel}`}>Method</svelte:element><ol>{#each recipe.steps as step, index (index)}<li><strong>{step.title}.</strong> {step.text}</li>{/each}</ol></section>{/if}
	<section class="nutrition" aria-label={nutritionHeading(recipe)}>
		<svelte:element this={`h${headingLevel}`}>{nutritionHeading(recipe)}</svelte:element>
		<dl>
			<div><dt>Calories</dt><dd>{formatNutrition(baseNutrition.kcal, "kcal")}</dd></div>
			<div><dt>Protein</dt><dd>{formatNutrition(baseNutrition.protein_g, "g")}</dd></div>
			<div><dt>Total carbs</dt><dd>{formatNutrition(baseNutrition.carbs_g, "g")}</dd></div>
			<div><dt>Fiber</dt><dd>{formatNutrition(baseNutrition.fiber_g, "g")}</dd></div>
			<div><dt>Net carbs</dt><dd>{formatNutrition(baseNutrition.net_carbs_g, "g")}</dd></div>
		</dl>
		{#key recipe.id}<NutrientDisclosure nutrients={dailyValues} {interactive} headingLevel={headingLevel + 1} />{/key}
	</section>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.detail-appliances {
			display: flex;
			align-items: center;
			gap: 14px;
			margin: 16px 0;
			font-size: 0.84rem;
		}
		.appliance-icons {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.detail-facts {
			display: flex;
			gap: 25px;
			flex-wrap: wrap;
			margin: 20px 0;
		}
		.detail-facts span {
			font-size: 0.84rem;
		}
		.detail-facts strong {
			display: block;
			font-size: 1.1rem;
			color: var(--recipe-ink);
		}
		.recipe-photo {
			max-width: 60rem;
			margin: 22px 0;
		}
		.recipe-photo figcaption { font-size: 0.8rem; color: var(--recipe-muted); margin-top: 8px; }
		.source-credit { overflow-wrap: anywhere; }
		.recipe-photo img {
			display: block;
			width: 100%;
			height: auto;
			border-radius: 10px;
		}
		.family-box {
			background: var(--recipe-family);
			border-radius: 12px;
			padding: 16px 20px;
			margin: 20px 0;
		}
		.family-box p {
			font-size: 0.9rem;
		}
		.family-box :global(select) {
			/* Muted ink keeps the control's boundary at 3:1 or more. */
			border-color: var(--recipe-muted);
			max-width: 360px;
			margin-top: 6px;
			appearance: none;
		}
		.nutrition {
			margin-top: 20px;
		}
		.nutrition dl {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
			font-size: 0.84rem;
		}
		.nutrition dl > div {
			padding: 8px;
			background: var(--recipe-soft);
			border-radius: 6px;
		}
		.nutrition dt {
			font-size: 0.73rem;
			color: var(--recipe-muted);
		}
		.nutrition dd {
			font-weight: 650;
			margin: 2px 0;
		}
		@media (max-width: 600px) {
			.detail-facts {
				gap: 16px;
			}
			.detail-facts strong {
				font-size: 0.95rem;
			}
			.family-box {
				padding: 15px;
			}
		}
		/* The blog focus orange is under 3:1 on the family box; the recipe focus
		   colour is not. */
		.family-box :global(select:focus-visible) {
			outline-color: var(--recipe-focus);
		}
		.family-box :global([data-slot="native-select-wrapper"]) {
			width: 100%;
			max-width: 360px;
		}
		@media print {
			.recipe-photo {
				display: none;
			}
		}
	}
</style>
