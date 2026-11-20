<script>
	import RecipeContent from "./RecipeContent.svelte";

	// One card's recipe, or a whole collection: each recipe starts a new page.
	let { recipes, settings } = $props();
</script>

<section class="print-document" aria-label={recipes.length === 1 ? "Printable recipe" : "Printable recipes"}>
	{#each recipes as recipe (recipe.id)}
		<article class="print-meal" aria-label={recipe.title}>
			<RecipeContent {recipe} {settings} interactive={false} printOnly />
		</article>
	{/each}
</section>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.print-document { display: none; }
		@media print {
			.print-document { display: block; color: #000; background: #fff; }
			.print-meal + .print-meal { break-before: page; }
		}
	}
</style>
