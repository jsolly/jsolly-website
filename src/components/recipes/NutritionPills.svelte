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
			<li data-nutrient={key} title={description}>{label}</li>
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
		.nutrition-pills li[data-nutrient="immune"] { background: #e3edda; color: #29451f; border-color: #c4d6b7; }
		.nutrition-pills li[data-nutrient="iron"] { background: #e2e5e9; color: #353c46; border-color: #bcc2cc; }
		.nutrition-pills li[data-nutrient="omega"] { background: #dcecf5; color: #204b65; border-color: #b0cfdf; }
		@media (prefers-color-scheme: dark) {
			.nutrition-pills li[data-nutrient="immune"] { background: #2d4228; color: #dcebd2; border-color: #526b47; }
			.nutrition-pills li[data-nutrient="iron"] { background: #363d47; color: #e0e5ed; border-color: #606b7a; }
			.nutrition-pills li[data-nutrient="omega"] { background: #243f50; color: #d5eaf6; border-color: #476a80; }
		}
	}
</style>
