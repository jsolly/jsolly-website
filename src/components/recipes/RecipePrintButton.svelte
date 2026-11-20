<script>
	import Printer from "@lucide/svelte/icons/printer";
	import Button from "../../lib/components/ui/button.svelte";
	import Input from "../../lib/components/ui/input.svelte";
	import { needsSafariPrint, safariPrintLinks } from "./safari-print.mjs";

	// `href` is the page Safari opens to print from: the recipe, or the
	// collection for a whole-collection print; `subject` names it in the help.
	// `busy` marks a print in progress without disabling, so focus stays put.
	let { href, label = "Print recipe", subject = "recipe", onPrint, disabled = false, busy = false, variant = "default", class: className = "" } = $props();
	let origin = $state("");
	const links = $derived(origin ? safariPrintLinks(href, origin) : null);
	const linkId = $props.id();

	function print() {
		if (needsSafariPrint(navigator, window.matchMedia("(display-mode: standalone)").matches)) {
			origin = window.location.origin;
			return;
		}
		onPrint();
	}
</script>

<div class="recipe-print-action">
	<Button type="button" {variant} class={`${variant === "default" ? "print-recipe" : ""} ${className}`} {disabled} aria-busy={busy || undefined} onclick={print}><Printer aria-hidden="true" />{label}</Button>
	{#if links}
		<div class="safari-print-help">
			<p role="status">To print from this Home Screen app, open the {subject} in Safari, then tap {label} there. Your servings, units and optional side{subject === "recipe" ? " are" : "s are"} included in the link. Opening Safari needs an internet connection.</p>
			{#if links.safari}<Button variant="outline" href={links.safari}>Open in Safari</Button>{/if}
			<label for={linkId}>If Safari does not open, copy this {subject} link and paste it into Safari:</label>
			<Input id={linkId} aria-label={`${subject === "recipe" ? "Recipe" : "Collection"} link for Safari`} readonly value={links.url} />
		</div>
	{/if}
</div>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.recipe-print-action { min-width: 0; }
		.recipe-print-action :global(.print-recipe) { min-height: 48px; padding: 12px 18px; gap: 8px; font-size: 1rem; font-weight: 700; background: var(--recipe-accent); color: var(--recipe-accent-text); border-color: var(--recipe-accent); }
		.recipe-print-action :global(.print-recipe:hover) { background: color-mix(in oklch, var(--recipe-accent), var(--recipe-accent-text) 15%); }
		.safari-print-help { max-width: 32rem; margin-top: 12px; font: 0.9rem/1.5 var(--font-body); }
		.safari-print-help p { margin-bottom: 12px; }
		.safari-print-help label { display: block; margin-top: 12px; }
		@media print { .recipe-print-action { display: none; } }
	}
</style>
