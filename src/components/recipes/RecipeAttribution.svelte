<script>
	let { recipe } = $props();
</script>

{#if recipe.sourceRecipe}<p class="source-credit">Adapted from <a href={recipe.sourceRecipe.resolvedUrl || recipe.sourceRecipe.url}>{recipe.sourceRecipe.author || "the original publisher"}</a>.</p>{/if}

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.source-credit { overflow-wrap: anywhere; font-size: 0.9rem; color: var(--recipe-muted); }
	}
</style>
