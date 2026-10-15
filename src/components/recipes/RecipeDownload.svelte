<script>
	import FileJson from "@lucide/svelte/icons/file-json";
	import FileText from "@lucide/svelte/icons/file-text";
	import { onDestroy } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import { documentMarkdown, recipeBundle } from "./recipe-export.mjs";

	let { recipes, settings, disabled = false } = $props();
	let message = $state("");
	let previousUrl;
	function download(format) {
		try {
			const bundle = recipeBundle(recipes, settings);
			const body = format === "json" ? JSON.stringify(bundle, null, 2) : bundle.recipes.map((document) => documentMarkdown(document)).join("\n---\n\n");
			const url = URL.createObjectURL(new Blob([body], { type: format === "json" ? "application/json" : "text/markdown" }));
			if (previousUrl) URL.revokeObjectURL(previousUrl);
			previousUrl = url;
			const link = document.createElement("a");
			link.href = url;
			link.download = `${recipes.length === 1 ? recipes[0].id : "recipe-library"}-${settings.units}.${format === "json" ? "json" : "md"}`;
			link.click();
			message = "Download prepared with your servings and units.";
		} catch (error) {
			message = "The recipe download could not be prepared. Try again.";
			console.error(message, error);
		}
	}
	onDestroy(() => { if (previousUrl) URL.revokeObjectURL(previousUrl); });
</script>
<div class="recipe-download recipe-enhanced">
	<Button variant="outline" {disabled} onclick={() => download("md")}><FileText aria-hidden="true" />Download Markdown</Button>
	<Button variant="outline" {disabled} onclick={() => download("json")}><FileJson aria-hidden="true" />Download JSON</Button>
	<p role="status">{message}</p>
</div>
<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.recipe-download { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
		p { flex-basis: 100%; margin: 0; }
		@media print { .recipe-download { display: none; } }
	}
</style>
