<script>
	import Info from "@lucide/svelte/icons/info";
	import Button from "../../lib/components/ui/button.svelte";
	import DialogRoot from "../../lib/components/ui/dialog.svelte";
	import DialogContent from "../../lib/components/ui/dialog-content.svelte";
	import DialogDescription from "../../lib/components/ui/dialog-description.svelte";
	import DialogTitle from "../../lib/components/ui/dialog-title.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import MeasurementAssumptions from "./MeasurementAssumptions.svelte";

	let { units, onUnitsChange, disabled = false, recipeId = "" } = $props();
	const id = $props.id();
	let open = $state(false);
	let trigger = $state(null);
	let dialog = $state(null);
	const assumptionsHref = $derived(recipeId ? `/recipes/${recipeId}/assumptions/` : "/recipes/assumptions/");
</script>

<div class="unit-control recipe-enhanced">
	<div class="unit-label"><label for={id}>Ingredient units</label><Button bind:ref={trigger} type="button" variant="ghost" size="icon" class="unit-help" aria-label="Measurement assumptions" aria-haspopup="dialog" aria-expanded={open} {disabled} onclick={() => (open = true)}><Info aria-hidden="true" /></Button></div>
	<NativeSelect {id} value={units} {disabled} onchange={(event) => onUnitsChange(event.currentTarget.value)}>
		<option value="grams">Grams only (100 g)</option>
		<option value="us">US imperial (4 oz, 1 cup)</option>
		<option value="metric">Metric (100 g, 250 mL)</option>
	</NativeSelect>
</div>
<DialogRoot bind:open>
	<DialogContent class="measurement-assumptions-dialog" bind:ref={dialog} tabindex={-1} showCloseButton={false} onOpenAutoFocus={(event) => { event.preventDefault(); dialog?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); trigger?.focus(); }}>
		<DialogTitle>Measurement assumptions</DialogTitle>
		<DialogDescription>How ingredient units and approximate conversions work.</DialogDescription>
		<MeasurementAssumptions />
		<Button variant="outline" onclick={() => (open = false)}>Close and continue</Button>
	</DialogContent>
</DialogRoot>
<noscript><a href={assumptionsHref}>Measurement assumptions</a></noscript>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		:global(.measurement-assumptions-dialog) { max-width: min(42rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; overscroll-behavior: contain; }
		.unit-control { display: grid; gap: 4px; max-width: 100%; }
		.unit-label { display: flex; align-items: center; gap: 4px; }
		.unit-label :global(.unit-help) { width: 28px; height: 28px; min-height: 28px; padding: 4px; color: var(--recipe-accent); }
		label { font-size: 0.86rem; font-weight: 600; }
		.unit-control :global(select) { min-height: 44px; height: auto; background: var(--recipe-paper); color: var(--recipe-ink); border: 1px solid var(--recipe-muted); padding: 8px 32px 8px 10px; }
		@media print { .unit-control { display: none; } }
	}
</style>
