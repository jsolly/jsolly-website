<script>
	import { dietaryLabels } from "./constants.mjs";
	import NutritionPills from "./NutritionPills.svelte";
	import RecipeAttribution from "./RecipeAttribution.svelte";
	import RecipeBody from "./RecipeBody.svelte";
	import { dietaryClass } from "./recipe-logic.mjs";

	// One cooking document for recipe pages and printed card packets.
	let { recipe, settings, interactive = true, printOnly = false, onSideChange, controls } = $props();
</script>

<div class="recipe-content">
	<span class="badge">{dietaryLabels[dietaryClass(recipe)]}</span>
	<h1 class="print-title">{recipe.title}</h1>
	<NutritionPills {recipe} servings={settings.servings} />
	<p class="detail-summary">{recipe.summary}</p>
	<RecipeAttribution {recipe} />
	{#if controls}{@render controls()}{/if}
	<RecipeBody {recipe} {settings} {interactive} {printOnly} {onSideChange} />
</div>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		h1 { font: 600 clamp(2rem, 4vw, 3rem) / 1.13 var(--font-heading); margin: 14px 0 10px; }
		.badge { display: inline-block; background: var(--recipe-badge); padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; }
		.detail-summary { margin: 10px 0 4px; line-height: 1.4; }
		@media print {
			.recipe-content :global(.nutrition-info) { display: none; }
			.recipe-content :global(.nutrient-trigger) { background: transparent; border: 0; box-shadow: none; }
		}
	}
</style>
