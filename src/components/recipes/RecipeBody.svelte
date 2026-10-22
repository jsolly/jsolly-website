<script>
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import { BASE_SERVINGS } from "./constants.mjs";
	import { ingredientMeasure } from "./ingredient-units.mjs";
	import NutrientDisclosure from "./NutrientDisclosure.svelte";
	import NutritionHelp from "./NutritionHelp.svelte";
	import { dailyNutrition } from "./nutrition.mjs";
	import RecipeFlow from "./RecipeFlow.svelte";
	import {
		displayNutrition,
		formatNutrition,
		formatQuantity,
		ingredientAmount,
		nutritionHeading,
		nutritionPortionLabel,
		selectedSide,
		sideNutrition,
	totalTimeLabel,
	} from "./recipe-logic.mjs";

	// A recipe's appliances, facts, photo, family side, cooking flow and
	// nutrition, shared by the recipe page and the library's recipe dialog.
	let {
		recipe,
		settings,
		interactive = true,
		printOnly = false,
		headingLevel = 3,
		onSideChange,
	} = $props();
	const sideId = $props.id();
	const selectedSideId = $derived(
		settings.familyChoice[recipe.id] || "",
	);
	const baseNutrition = $derived(displayNutrition(recipe, settings.servings));
	const dailyValues = $derived(
		dailyNutrition(recipe, settings.servings, ingredientAmount).filter(
			(nutrient) => nutrient.amount !== null,
		),
	);
	const side = $derived(selectedSide(recipe, selectedSideId));
	const sideMacros = $derived(sideNutrition(recipe, selectedSideId));
	// The optional side is a fixed amount per diner, whatever the servings.
	const sideAmount = $derived(
		side && settings.familyDiners > 0 &&
			ingredientMeasure(side, side.amount * settings.familyDiners, settings.units, formatQuantity).quantity,
	);
</script>

<div class="recipe-body">
	<div class="detail-appliances">
		<span>Kitchen stuff needed</span>
		<div class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name} />{/each}</div>
	</div>
	<div class="detail-facts">
		<span><strong>{recipe.activeMinutes === null ? "Not provided" : `${recipe.activeMinutes} min`}</strong> {recipe.sourceRecipe ? "prep time" : "active time"}{settings.servings > BASE_SERVINGS ? " / base batch" : ""}</span>
		<span><strong>{settings.servings}</strong> servings</span>
		<span><strong>{totalTimeLabel(recipe, settings.servings)}</strong> ready in</span>
	</div>
	{#if recipe.image}
		<figure class="recipe-photo">
			<img src={recipe.image.src} srcset={recipe.image.detailSrcset} sizes="(max-width:600px) 320px, (max-width:1000px) 680px, 960px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="eager" decoding="async" />
		</figure>
	{/if}
	{#if recipe.familyOptions.length && (!printOnly || side)}
		<div class="family-box" class:has-side={Boolean(side)}>
			<label for={sideId}
				>Add a side{#if printOnly}<span>{side.label}</span>{:else}<NativeSelect id={sideId} value={selectedSideId} disabled={!interactive} onchange={(event) => onSideChange?.(event.currentTarget.value)}>
					<option value="">None</option>
					{#each recipe.familyOptions as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
				</NativeSelect>{/if}</label
			>
			{#if side}
				<p>{sideAmount} {side.ingredientName} · serve separately</p>
				<div class="side-nutrition">Side only, per person: {formatNutrition(sideMacros.kcal, "kcal")} · Protein {formatNutrition(sideMacros.protein_g, "g")} · Fat {formatNutrition(sideMacros.fat_g, "g")} · Carbs {formatNutrition(sideMacros.carbs_g, "g")} · Fiber {formatNutrition(sideMacros.fiber_g, "g")} · Net carbs {formatNutrition(sideMacros.net_carbs_g, "g")}. Base nutrition below excludes this side.</div>
			{/if}
		</div>
	{/if}
	{#key recipe.id}<RecipeFlow {recipe} {settings} {interactive} {printOnly} {headingLevel} />{/key}
	<section class="nutrition" aria-label={nutritionHeading(recipe, settings.servings)}>
		<svelte:element this={`h${headingLevel}`}>Nutrition</svelte:element><p class="nutrition-portion">{nutritionPortionLabel(recipe, settings.servings)}</p>
		<dl>
			<div><dt><span aria-hidden="true">🔥</span> Calories</dt><dd>{formatNutrition(baseNutrition.kcal, "kcal")}</dd></div>
			<div><dt><span aria-hidden="true">💪</span> Protein</dt><dd>{formatNutrition(baseNutrition.protein_g, "g")}</dd></div>
			<div><dt>Fat</dt><dd>{formatNutrition(baseNutrition.fat_g, "g")}</dd></div>
			<div><dt>Carbs</dt><dd>{formatNutrition(baseNutrition.carbs_g, "g")}</dd></div>
			<div><dt>Fiber</dt><dd>{formatNutrition(baseNutrition.fiber_g, "g")}</dd></div>
			<div><dt>Net carbs <NutritionHelp topic="net-carbs" /></dt><dd>{formatNutrition(baseNutrition.net_carbs_g, "g")}</dd></div>
		</dl>
		{#key recipe.id}<NutrientDisclosure nutrients={dailyValues} {interactive} {printOnly} headingLevel={headingLevel + 1} />{/key}
	</section>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.detail-appliances {
			display: grid;
			gap: 8px;
			margin: 12px 0;
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
			margin: 12px 0;
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
			margin: 16px 0;
		}
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
			margin: 12px 0;
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
		.nutrition-portion { margin: 0 0 12px; font-size: 0.85rem; color: var(--recipe-muted); }
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
				width: 70mm;
				max-width: 100%;
				margin: 3mm 0;
				break-inside: avoid;
			}
			.recipe-photo img {
				max-height: 45mm;
				object-fit: contain;
				object-position: left center;
				border-radius: 0;
			}
			.side-nutrition,
			.family-box:not(.has-side) {
				display: none;
			}
		}
	}
</style>
