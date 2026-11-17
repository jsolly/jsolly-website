<script>
	import RecipeContent from "./RecipeContent.svelte";

	let { recipe, settings } = $props();
</script>

<section class="print-document" aria-label="Printable recipe">
		<article class="print-meal" aria-label={recipe.title}>
			<RecipeContent {recipe} {settings} interactive={false} printOnly />
		</article>
</section>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.print-document { display: none; }
		@media print {
			.print-document { display: block; color: #000; background: #fff; }
		}
	}
</style>
