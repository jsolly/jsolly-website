<script>
	import { BASE_SERVINGS, nutritionHighlights } from "./constants.mjs";
	import { nutrientFilters } from "./nutrient-filters.mjs";

	let { recipe, servings = BASE_SERVINGS } = $props();
	const flags = $derived(nutrientFilters(recipe, servings));
	const highlights = $derived(
		Object.entries(nutritionHighlights).filter(([key]) => flags[key]),
	);
</script>

{#if highlights.length}
	<ul class="nutrition-pills" aria-label="Nutrition highlights">
		{#each highlights as [key, { label, description }] (key)}
			<li title={description}>{label}</li>
		{/each}
	</ul>
{/if}

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.nutrition-pills {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			list-style: none;
			padding: 0;
			margin: 0;
		}
		.nutrition-pills li {
			border: 1px solid var(--recipe-line);
			border-radius: 999px;
			background: var(--recipe-badge);
			color: var(--recipe-ink);
			padding: 4px 9px;
			font-size: 0.75rem;
			font-weight: 600;
			line-height: 1.4;
		}
	}
</style>
