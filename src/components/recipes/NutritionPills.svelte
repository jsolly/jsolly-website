<script>
	import { nutritionHighlights } from "./constants.mjs";

	let { flags } = $props();
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
			gap: 8px;
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
		.nutrition-pills li[data-nutrient="immune"] { background: #fde6cf; border-color: #f0c08f; }
		.nutrition-pills li[data-nutrient="iron"] { background: #e2e5e9; border-color: #bcc2cc; }
		.nutrition-pills li[data-nutrient="omega"] { background: #dcecf5; border-color: #b0cfdf; }
		@media (prefers-color-scheme: dark) {
			.nutrition-pills li[data-nutrient="immune"] { background: #4a2f1c; border-color: #8c5a33; }
			.nutrition-pills li[data-nutrient="iron"] { background: #363d47; border-color: #606b7a; }
			.nutrition-pills li[data-nutrient="omega"] { background: #243f50; border-color: #476a80; }
		}
	}
</style>
