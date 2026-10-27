<script>
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import Input from "../../lib/components/ui/input.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import {
		applianceChoices,
		applianceLimits,
		defaultAppliances,
		nutritionHighlights,
		nutritionThresholds,
		proteins,
		SERVING_CHOICES,
		starchOptions,
	} from "./constants.mjs";
	import FilterMultiSelect from "./FilterMultiSelect.svelte";
	import NutritionHelp from "./NutritionHelp.svelte";
	import { choiceUnavailable } from "./nutrient-filters.mjs";
	import UnitControl from "./UnitControl.svelte";

	// The recipe library's controls: the collection links, servings, the
	// appliances on hand, the filters (protein and carb or ingredient choices,
	// then the nutrition checks) and the search.
	// Every control is disabled until the library hydrates. `filters` is the
	// library's DEFAULT_FILTERS-shaped filter state.
	let {
		collection,
		saved = false,
		onCollectionChange,
		query = $bindable(""),
		pathname,
		hydrated,
		servings,
		onServingsChange,
		units,
		onUnitsChange,
		shownApplianceKeys,
		collectionHasIron,
		smoothieIngredients,
		hasMatches,
		filters = $bindable(),
		appliancesOnHand = $bindable(),
	} = $props();
	const COLLECTION_LINKS = [
		{ collection: "meal", href: "/recipes/meals/", label: "Meals" },
		{ collection: "smoothie", href: "/recipes/smoothies/", label: "Smoothies" },
	];
	const uid = $props.id();
	const servingsId = `${uid}-servings`;
	const controlId = (name) => `${uid}-${name}`;
	// Unchecking handles zero; a checked appliance offers one up to its limit.
	const countChoices = (value) =>
		Array.from({ length: applianceLimits[value] }, (_, count) => count + 1);

	const shownAppliances = $derived(
		Object.entries(applianceChoices).filter(([value]) =>
			shownApplianceKeys.includes(value),
		),
	);
	// The nutrition checks the collection offers: each filter's key, label,
	// the filter that picking it applies and its tooltip.
	const nutritionChecks = $derived(
		[
			collection === "meal" && { key: "vegetarianOnly", label: "Vegetarian", applies: { vegetarian: true } },
			collection === "meal" && { key: "dumpAndGo", label: "Dump and go", applies: { dumpAndGo: true }, title: "Load the cooker and start; no separate browning or mid-cook additions. Preparation and finishing may still be needed." },
			{
				key: "immuneSupport",
				label: nutritionHighlights.immune.label,
				applies: { immune: true },
				title:
					"At least 20% Daily Value in two or more of vitamins A, C, D, zinc and selenium per serving",
			},
			collectionHasIron && {
				key: "ironRich",
				label: nutritionHighlights.iron.label,
				applies: { iron: true },
				title: "At least 20% Daily Value of iron per serving",
			},
			{
				key: "omega3",
				label: nutritionHighlights.omega.label,
				applies: { omega: true },
				title:
					"At least 0.5 g recorded ALA, EPA, and DHA per meal serving or 8 oz smoothie glass",
			},
		].filter(Boolean),
	);

	// The collection shown is "page" on its own page; on the landing, which
	// shows either, it is only the current one.
	function current(link) {
		if (link.collection !== collection) return ;
		return pathname === link.href ? "page" : "true";
	}

	function setAppliance(value, count) {
		appliancesOnHand = { ...appliancesOnHand, [value]: count };
	}
</script>

<div class="library-controls">
	<nav class="collection-options" aria-label="Recipe type"
		>{#each COLLECTION_LINKS as link (link.href)}<a href={saved ? `/recipes/saved/?collection=${link.collection}` : link.href} aria-current={current(link)} onclick={(event) => { if (saved) { event.preventDefault(); onCollectionChange(link.collection); } }}>{link.label}</a>{/each}</nav
	>
	<div class="library-intro">
		<div class="servings-setting">
			<label for={servingsId}>Servings</label><NativeSelect id={servingsId} value={servings} onchange={(event) => onServingsChange(event.currentTarget.value)} disabled={!hydrated}
				>{#each SERVING_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}</NativeSelect
			>
		</div>
		<UnitControl {units} {onUnitsChange} disabled={!hydrated} />
	</div>

	<fieldset class="inventory">
		<legend>Appliances on hand</legend>
		<!-- Keyboard focus lets users scroll the meals' appliance list; the
		     smoothies' single appliance needs no scrolling region. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<section class="inventory-options" class:simple-inventory={collection === "smoothie"} tabindex={collection === "meal" ? 0 : undefined} aria-label={collection === "meal" ? "Appliances on hand, scroll for more" : undefined}>
			{#each shownAppliances as [value, label], index (value)}
				{#if Object.hasOwn(applianceLimits, value)}
					<!-- Re-ticking a counted appliance brings back its usual count. -->
					<div class="inventory-count">
						<label for={controlId(`appliance-${index}`)}
							><Checkbox id={controlId(`appliance-${index}`)} aria-label={label} checked={appliancesOnHand[value] > 0} onCheckedChange={(checked) => setAppliance(value, checked ? defaultAppliances[value] : 0)} disabled={!hydrated} /><ApplianceIcon
								name={value}
								decorative
							/>{label}</label
						><label class="visually-hidden" for={controlId(`count-${index}`)}>{label} count</label><NativeSelect
							id={controlId(`count-${index}`)}
							disabled={!hydrated || appliancesOnHand[value] === 0}
							value={appliancesOnHand[value] || defaultAppliances[value]}
							onchange={(event) => setAppliance(value, Number(event.currentTarget.value))}>{#each countChoices(value) as count (count)}<option value={count}>{count}</option>{/each}</NativeSelect
						>
					</div>
				{:else}
					<label for={controlId(`appliance-${index}`)}
						><Checkbox
							id={controlId(`appliance-${index}`)}
							aria-label={label}
							checked={appliancesOnHand[value] > 0}
							onCheckedChange={(checked) => setAppliance(value, checked ? 1 : 0)}
							disabled={!hydrated}
						/><ApplianceIcon name={value} decorative />{label}</label
					>
				{/if}
			{/each}
		</section>
	</fieldset>
	<!-- The legend floats so it lines up with the help trigger beside it. -->
	<fieldset class="nutrient-filters">
		<legend>Filters</legend><NutritionHelp />
		<!-- The protein and carb (or ingredient) choices lead the filters. -->
		<div class="filter-fields" class:smoothie-filters={collection === "smoothie"}>
			{#if collection === "meal"}
				<FilterMultiSelect label="Proteins" options={proteins} bind:selected={filters.proteinChoice} emptyLabel="All proteins" disabled={!hydrated} canSelect={(values) => hasMatches({ protein: values })} />
				<FilterMultiSelect label="Carbs" showClear={false} options={starchOptions} bind:selected={filters.starchChoice} emptyLabel="All starches" disabled={!hydrated} canSelect={(values) => hasMatches({ starch: values })} />
			{:else}
				<div class="smoothie-ingredients">
					<FilterMultiSelect label="Ingredients" options={smoothieIngredients} bind:selected={filters.ingredientChoice} emptyLabel="All ingredients" disabled={!hydrated} canSelect={(values) => hasMatches({ ingredients: values })} />
				</div>
			{/if}
		</div>
		<div class="nutrient-options">
			{#each nutritionChecks as check (check.key)}<label for={controlId(check.key)} title={check.title}
					><Checkbox
						id={controlId(check.key)}
						aria-label={check.label}
						aria-describedby={nutritionThresholds[check.key] ? controlId(`${check.key}-threshold`) : undefined}
						bind:checked={filters[check.key]}
						disabled={!hydrated || choiceUnavailable(filters[check.key], () => hasMatches(check.applies))}
					/>
					{check.label}</label
				>{/each}
		</div>
		<!-- The thresholds the nutrition help states, as each check's description. -->
		<div hidden>
			{#each Object.entries(nutritionThresholds) as [key, threshold] (key)}<p id={controlId(`${key}-threshold`)}>{threshold}</p>{/each}
		</div>
	</fieldset>
	<div class="recipe-search">
		<label for={`${uid}-search`}>Search recipes</label>
		<Input id={`${uid}-search`} type="search" bind:value={query} disabled={!hydrated} placeholder="Try chicken, garlic, or air fryer" aria-describedby={`${uid}-search-help`} />
		<small id={`${uid}-search-help`}>Search names, ingredients, equipment and cooking details in this collection. Filters still apply.</small>
	</div>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.library-controls {
			background: var(--recipe-paper);
			border: 1px solid var(--recipe-line);
			border-radius: 12px;
			padding: 18px;
			margin-bottom: 24px;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 12px 24px;
		}
		.collection-options {
			grid-column: 1 / -1;
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
			padding: 6px;
			background: var(--recipe-soft);
			border-radius: 14px;
		}
		/* [href] outranks the library's link colour. */
		.collection-options a[href] {
			display: flex;
			align-items: center;
			justify-content: center;
			text-decoration: none;
			min-height: 72px;
			background: transparent;
			color: var(--recipe-ink);
			border: 1px solid transparent;
			border-radius: 10px;
			padding: 16px;
			font: 600 clamp(1.1rem, 3vw, 1.4rem) / 1.2 var(--font-heading);
		}
		.collection-options a[href][aria-current] {
			background: var(--recipe-accent);
			color: var(--recipe-accent-text);
		}
		.recipe-search { grid-column: 1 / -1; display: grid; gap: 4px; min-width: 0; }
		.recipe-search :global(input) { min-height: 44px; border-radius: 8px; }
		.library-intro {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: end;
			gap: 24px;
			grid-column: 1 / -1;
		}
		/* Each select sits beside its label, so it takes the label's text size
		   and weight from its row. */
		.servings-setting {
			font-size: 0.86rem;
			font-weight: 600;
			display: grid;
			gap: 4px;
		}
		.library-intro > .servings-setting {
			grid-column: 1;
			grid-row: 1;
		}
		.filter-fields {
			flex-basis: 100%;
			margin-top: 8px;
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 16px;
			min-height: 74px;
		}
		.smoothie-ingredients {
			grid-column: 1 / -1;
		}
		.filter-fields.smoothie-filters {
			min-height: 0;
			height: auto;
		}
		/* This outranks the library's general select rule. */
		.library-intro .servings-setting :global(select) {
			width: 72px;
			min-width: 72px;
			padding-right: 32px;
			appearance: none;
		}
		.inventory {
			grid-column: 1 / -1;
			border: 0;
			padding: 0;
			margin: 0;
			min-width: 0;
		}
		.inventory-options {
			height: 144px;
			overflow-y: auto;
			scrollbar-gutter: stable;
			border: 1px solid var(--recipe-line);
			border-radius: 8px;
			padding: 4px 12px;
		}
		.inventory-options.simple-inventory {
			height: auto;
			overflow: visible;
			scrollbar-gutter: auto;
			border: 0;
			padding: 0;
		}
		.inventory legend {
			font-size: 0.8rem;
			font-weight: 650;
			margin-bottom: 8px;
			padding: 0;
		}
		.inventory-options > label,
		.inventory-count {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 44px;
			padding: 4px 0;
		}
		/* The count select sits beside the label, so it takes the label's text
		   size and weight from the row. */
		.inventory-count {
			font-size: 0.86rem;
			font-weight: 600;
		}
		.inventory-count > label:first-child {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.inventory .inventory-count :global(select) {
			width: 65px;
			display: inline-block;
		}
		.inventory-count :global([data-slot="native-select-wrapper"]) {
			margin-left: auto;
		}
		.library-intro .servings-setting :global([data-slot="native-select-wrapper"]) { width: 72px; }
		.inventory-options > label:has(:global(:disabled)),
		.inventory-count:has(:global(:disabled)),
		.nutrient-options label:has(:global(:disabled)) {
			opacity: 0.45;
			cursor: not-allowed;
		}
		.nutrient-filters {
			border: 0;
			padding: 0;
			margin: 0;
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 0;
			grid-column: 1 / -1;
		}
		/* Floated, the legend is a flex item beside the help trigger rather
		   than the fieldset's caption. */
		.nutrient-filters legend {
			float: left;
			font-size: 0.8rem;
			font-weight: 650;
			margin-bottom: 0;
			padding: 0;
		}
		/* The nutrition help trigger is smaller than the library's buttons and
		   set like the legend beside it. */
		.nutrient-filters :global(.nutrition-info) {
			min-height: 32px;
			font-size: 0.8rem;
			font-weight: 650;
		}
		.nutrient-options {
			flex-basis: 100%;
			display: flex;
			align-items: center;
			gap: 8px 20px;
			flex-wrap: wrap;
		}
		.nutrient-options label {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 44px;
		}
		@media (max-width: 600px) {
			.library-controls {
				padding: 14px;
				gap: 12px;
			}
			.library-intro {
				grid-template-columns: 1fr;
				gap: 14px;
			}
			.filter-fields {
				grid-template-columns: 1fr;
				min-height: 164px;
				align-content: start;
			}
			.library-intro > .servings-setting {
				grid-column: 1;
				grid-row: 1;
			}
			.nutrient-filters {
				grid-column: 1 / -1;
			}
			.nutrient-options {
				gap: 4px 12px;
			}
		}
	}
</style>
