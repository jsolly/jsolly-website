<script>
	import Share2 from "@lucide/svelte/icons/share-2";
	import Button from "../../lib/components/ui/button.svelte";
	import { recipeHref } from "./recipe-url.mjs";

	// Shares the recipe link with the reader's servings and family side: the
	// share sheet where there is one, else the clipboard, else the link itself.
	let { recipe, settings, disabled = false } = $props();
	let message = $state("");
	let fallbackUrl = $state("");

	async function share() {
		const url = new URL(recipeHref(recipe, settings), window.location.origin);
		fallbackUrl = "";
		message = "";
		if (navigator.share) {
			try {
				await navigator.share({ title: recipe.title, url: url.href });
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError")
					return;
				if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
					console.error(`Sharing recipe ${recipe.id} failed.`, error);
				}
			}
		}
		if (navigator.clipboard) {
			try {
				await navigator.clipboard.writeText(url.href);
				message = "Recipe link copied.";
				return;
			} catch (error) {
				if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
					console.error(`Copying recipe ${recipe.id} link failed.`, error);
				}
			}
		}
		fallbackUrl = url.href;
		message = "Copy this recipe link:";
	}
</script>

<div class="recipe-share">
	<Button variant="outline" {disabled} onclick={share}><Share2 aria-hidden="true" size={18} />Share this recipe</Button>
	<p role="status">{message}{#if fallbackUrl} <a href={fallbackUrl}>{fallbackUrl}</a>{/if}</p>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.recipe-share {
			margin-top: 24px;
			padding-top: 16px;
			border-top: 1px solid var(--recipe-line);
		}
		/* The status line stays in the accessibility tree so announcements
		   fire; empty, it takes no space. */
		p:empty {
			margin: 0;
		}
		a {
			overflow-wrap: anywhere;
		}
		@media print {
			.recipe-share {
				display: none;
			}
		}
	}
</style>
