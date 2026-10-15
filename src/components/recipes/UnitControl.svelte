<script>
	import Info from "@lucide/svelte/icons/info";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import PopoverRoot from "../../lib/components/ui/popover.svelte";
	import PopoverContent from "../../lib/components/ui/popover-content.svelte";
	import PopoverTrigger from "../../lib/components/ui/popover-trigger.svelte";
	import MeasurementAssumptions from "./MeasurementAssumptions.svelte";

	let { units, onUnitsChange, disabled = false, recipeId = "" } = $props();
	const id = $props.id();
	let open = $state(false);
	let trigger = $state(null);
	let content = $state(null);
	const contentId = `${id}-help`;
	const assumptionsHref = $derived(recipeId ? `/recipes/${recipeId}/assumptions/` : "/recipes/assumptions/");

	function restoreFocus(event) {
		event.preventDefault();
		// bits-ui may remount its focus scope while the popover is still open.
		// A link reached with Tab must keep focus through that remount.
		if (!open && content?.contains(document.activeElement)) trigger?.focus();
	}
</script>

<div class="unit-control recipe-enhanced">
	<div class="unit-label">
		<label for={id}>Ingredient units</label>
		<PopoverRoot bind:open>
			<PopoverTrigger bind:ref={trigger} class="unit-help" aria-label="Measurement assumptions" aria-describedby={contentId} {disabled} openOnHover openDelay={100} closeDelay={120}><Info aria-hidden="true" /></PopoverTrigger>
			<PopoverContent bind:ref={content} id={contentId} class="measurement-assumptions-help" portalProps={{ disabled: true }} sideOffset={4} trapFocus={false} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={restoreFocus}>
				<MeasurementAssumptions />
				<a href={assumptionsHref}>Measurement assumptions</a>
			</PopoverContent>
		</PopoverRoot>
	</div>
	<NativeSelect {id} value={units} {disabled} onchange={(event) => onUnitsChange(event.currentTarget.value)}>
		<option value="grams">Grams only (100 g)</option>
		<option value="us">US imperial (4 oz, 1 cup)</option>
		<option value="metric">Metric (100 g, 250 mL)</option>
	</NativeSelect>
</div>
<noscript><a href={assumptionsHref}>Measurement assumptions</a></noscript>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		:global(.measurement-assumptions-help) { z-index: 60; width: 320px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); overflow-y: auto; background: var(--recipe-paper); color: var(--recipe-ink); border: 1px solid var(--recipe-line); border-radius: 8px; padding: 12px; font: 13px/1.5 var(--font-body); box-shadow: 0 4px 16px #0003; }
		.unit-label :global(.measurement-assumptions-help h2) { margin-top: 0; font: 600 1.1rem/1.4 var(--font-heading); }
		.unit-control { display: grid; gap: 4px; max-width: 100%; }
		.unit-label { display: flex; align-items: center; gap: 4px; }
		.unit-label :global(.unit-help) { display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 0; cursor: pointer; width: 28px; height: 28px; min-height: 28px; padding: 4px; color: var(--recipe-accent); }
		.unit-label :global(.unit-help svg) { width: 16px; height: 16px; }
		label { font-size: 0.86rem; font-weight: 600; }
		.unit-control :global(select) { min-height: 44px; height: auto; background: var(--recipe-paper); color: var(--recipe-ink); border: 1px solid var(--recipe-muted); padding: 8px 32px 8px 10px; }
		@media print { .unit-control { display: none; } }
	}
</style>
