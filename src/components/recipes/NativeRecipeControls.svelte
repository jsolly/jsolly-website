<script>
	import Button from "../../lib/components/ui/button.svelte";
	import Input from "../../lib/components/ui/input.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import { applianceChoices, applianceLimits, BASE_SERVINGS, DEFAULT_FILTERS, defaultAppliances, nutritionThresholds, proteins, starchOptions } from "./constants.mjs";

	let { collection, pathname, metadata, settings = { servings: BASE_SERVINGS, units: "us", filters: DEFAULT_FILTERS, appliancesOnHand: defaultAppliances }, query = "", seed = "" } = $props();
	const ingredients = $derived(metadata.smoothieIngredients);
	const shownAppliances = $derived(Object.entries(applianceChoices).filter(([key]) => metadata.shownAppliances.includes(key)));
	const choiceGroups = $derived(collection === "meal" ? [{ name: "proteinChoice", label: "Proteins", options: proteins }, { name: "starchChoice", label: "Carbs", options: starchOptions }] : [{ name: "ingredientChoice", label: "Ingredients", options: ingredients }]);
	const checks = $derived([
		...(collection === "meal" ? [["mealKetoOnly", "Keto"], ["vegetarianOnly", "Vegetarian"], ["dumpAndGo", "Dump and go"]] : [["smoothieKetoOnly", "Keto Friendly"]]),
		["immuneSupport", "Immune support"],
		...(metadata.collectionHasIron ? [["ironRich", "Iron-rich"]] : []),
		["omega3", "High in Omega-3s"],
	]);
</script>

<form id="recipe-browse-form" class="native-recipe-controls" method="get" action={pathname}>
	<input type="hidden" name="browse" value="1" />
	<input type="hidden" name="seed" value={seed} />
	{#each choiceGroups as group (group.name)}
		<fieldset><legend>{group.label}</legend><div class="choices">{#each Object.entries(group.options) as [value, label] (value)}<label><input type="checkbox" name={group.name} {value} checked={settings.filters[group.name].includes(value)} />{label}</label>{/each}</div></fieldset>
	{/each}
	<fieldset><legend>Appliances on hand</legend><div class="appliances">{#each shownAppliances as [key, label], index (key)}<label for={`native-appliance-${index}`}>{label}<NativeSelect id={`native-appliance-${index}`} name={`appliance.${key}`} value={settings.appliancesOnHand[key]}>{#each Array.from({ length: (applianceLimits[key] ?? 1) + 1 }, (_, count) => count) as count (count)}<option value={count}>{count === 0 ? "None" : count}</option>{/each}</NativeSelect></label>{/each}</div></fieldset>
	<fieldset><legend>Filters</legend><div class="choices">{#each checks as [key, label] (key)}<label title={nutritionThresholds[key]}><input type="checkbox" name={key} value="1" checked={settings.filters[key]} />{label}</label>{/each}</div></fieldset>
	<label for="native-recipe-search">Search recipes<Input id="native-recipe-search" name="q" type="search" value={query} maxlength={200} placeholder="Try chicken, garlic, or air fryer" /></label>
	<p>Search names, ingredients, equipment and cooking details. Apply filters to reload the results.</p>
	<div class="actions"><Button type="submit">Apply filters</Button><a href={pathname}>Reset filters</a></div>
</form>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.native-recipe-controls { display: grid; gap: 16px; padding: 18px; margin-bottom: 24px; border: 1px solid var(--recipe-line); border-radius: 12px; background: var(--recipe-paper); color: var(--recipe-ink); }
		fieldset { min-width: 0; border: 0; padding: 0; margin: 0; }
		legend { font-weight: 650; margin-bottom: 8px; }
		.appliances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
		label { display: grid; gap: 6px; min-width: 0; }
		.choices { display: flex; flex-wrap: wrap; gap: 4px 20px; }
		.choices label { display: flex; align-items: center; gap: 8px; min-height: 44px; }
		input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--recipe-accent); }
		.native-recipe-controls :global(select), .native-recipe-controls :global(input[type="search"]) { min-height: 44px; height: auto; background: var(--recipe-paper); color: var(--recipe-ink); }
		.native-recipe-controls :global([data-slot="native-select-wrapper"]) { width: 100%; }
		.actions { display: flex; align-items: center; gap: 20px; }
		p { margin: 0; font-size: 0.86rem; }
		@media (max-width: 600px) { .appliances { grid-template-columns: 1fr; } }
		@media print { .native-recipe-controls { display: none; } }
	}
</style>
