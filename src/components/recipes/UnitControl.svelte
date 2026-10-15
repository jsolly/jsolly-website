<script>
	import Info from "@lucide/svelte/icons/info";
	import Button from "../../lib/components/ui/button.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";

	let { units, onUnitsChange, disabled = false } = $props();
	const id = $props.id();
</script>

<div class="unit-control recipe-enhanced">
	<div class="unit-label"><label for={id}>Ingredient units</label><Button href="/recipes/assumptions/" variant="ghost" size="icon" class="unit-help" aria-label="Measurement assumptions"><Info aria-hidden="true" /></Button></div>
	<NativeSelect {id} value={units} {disabled} onchange={(event) => onUnitsChange(event.currentTarget.value)}>
		<option value="grams">Grams only (100 g)</option>
		<option value="us">US imperial (4 oz, 1 cup)</option>
		<option value="metric">Metric (100 g, 250 mL)</option>
	</NativeSelect>
</div>
<noscript><a href="/recipes/assumptions/">Measurement assumptions</a></noscript>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.unit-control { display: grid; gap: 4px; max-width: 100%; }
		.unit-label { display: flex; align-items: center; gap: 4px; }
		.unit-label :global(.unit-help) { width: 28px; height: 28px; min-height: 28px; padding: 4px; color: var(--recipe-accent); }
		label { font-size: 0.86rem; font-weight: 600; }
		.unit-control :global(select) { min-height: 44px; height: auto; background: var(--recipe-paper); color: var(--recipe-ink); border: 1px solid var(--recipe-muted); padding: 8px 32px 8px 10px; }
		@media print { .unit-control { display: none; } }
	}
</style>
