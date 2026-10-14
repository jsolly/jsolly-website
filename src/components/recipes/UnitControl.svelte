<script>
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import { UNIT_LABELS } from "./ingredient-units.mjs";

	let { units, onUnitsChange, disabled = false } = $props();
	const id = $props.id();
</script>

<div class="unit-control recipe-enhanced">
	<label for={id}>Ingredient units</label>
	<NativeSelect {id} value={units} {disabled} onchange={(event) => onUnitsChange(event.currentTarget.value)}>
		{#each Object.entries(UNIT_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
	</NativeSelect>
</div>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.unit-control { display: grid; gap: 4px; max-width: 100%; }
		label { font-size: 0.86rem; font-weight: 600; }
		.unit-control :global(select) { min-height: 44px; height: auto; background: var(--recipe-paper); color: var(--recipe-ink); border: 1px solid var(--recipe-muted); padding: 8px 32px 8px 10px; }
		@media print { .unit-control { display: none; } }
	}
</style>
