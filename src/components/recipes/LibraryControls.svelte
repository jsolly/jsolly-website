<script>
	import Button from "../../lib/components/ui/button.svelte";
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import {
		applianceChoices,
		applianceDependencies,
		applianceLimits,
		carbStyles,
		mealStyleDescriptions,
		proteins,
		SERVING_CHOICES,
		starchTypes,
	} from "./constants.mjs";
	import FilterMultiSelect from "./FilterMultiSelect.svelte";
	import NutritionHelp from "./NutritionHelp.svelte";

	// The recipe library's controls: the collection links, servings, the
	// filters, the appliances on hand, the nutrition filters and Print all.
	// Every control is disabled until the library hydrates.
	let {
		collection,
		pathname,
		hydrated,
		servings,
		onServingsChange,
		collectionRecipes,
		collectionHasIron,
		smoothieIngredients,
		hasMatches,
		onPrintAll,
		proteinChoice = $bindable(),
		starchChoice = $bindable(),
		ingredientChoice = $bindable(),
		carbChoice = $bindable(),
		smoothieKetoOnly = $bindable(),
		immuneSupport = $bindable(),
		ironRich = $bindable(),
		omega3 = $bindable(),
		appliancesOnHand = $bindable(),
	} = $props();
	const COLLECTION_LINKS = [
		{ collection: "meal", href: "/recipes/meals/", label: "Meals" },
		{ collection: "smoothie", href: "/recipes/smoothies/", label: "Smoothies" },
	];
	const starchOptions = Object.fromEntries(
		Object.entries(starchTypes).filter(
			([key]) => !["all", "none"].includes(key),
		),
	);
	const uid = $props.id();
	const servingsId = `${uid}-servings`;
	const mealStyleId = `${uid}-meal-style`;
	const controlId = (name) => `${uid}-${name}`;
	// Each counted appliance offers 0 up to its limit.
	const countChoices = (value) =>
		Array.from({ length: applianceLimits[value] + 1 }, (_, count) => count);

	const shownAppliances = $derived(
		Object.entries(applianceChoices).filter(([value]) =>
			collectionRecipes.some((recipe) =>
				recipe.appliancesNeeded.includes(value),
			),
		),
	);

	// The collection shown is "page" on its own page; on the landing, which
	// shows either, it is only the current one.
	function current(link) {
		if (link.collection !== collection) return ;
		return pathname === link.href ? "page" : "true";
	}

	// An appliance that needs another (pans need the oven) is unavailable
	// without it.
	function unavailable(value) {
		const needs = applianceDependencies[value];
		return Boolean(needs) && !appliancesOnHand[needs];
	}
</script>

<div class="library-controls">
	<nav class="collection-options" aria-label="Recipe type"
		>{#each COLLECTION_LINKS as link (link.href)}<a href={link.href} aria-current={current(link)}>{link.label}</a>{/each}</nav
	>
	<div class="library-intro">
		<label class="servings-setting" for={servingsId}
			>Servings<NativeSelect id={servingsId} value={servings} onchange={(event) => onServingsChange(event.currentTarget.value)} disabled={!hydrated}
				>{#each SERVING_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}</NativeSelect
			></label
		>
	</div>

	<div class="recipe-filter-selects" class:smoothie-filters={collection === "smoothie"}>
		<div class="filter-fields">
			{#if collection === "meal"}
				<FilterMultiSelect label="Proteins" options={proteins} bind:selected={proteinChoice} emptyLabel="All proteins" disabled={!hydrated} canSelect={(values) => hasMatches({ protein: values })} />
				<FilterMultiSelect label="Carbs" options={starchOptions} bind:selected={starchChoice} emptyLabel="All starches" disabled={!hydrated} canSelect={(values) => hasMatches({ starch: values })} />
			{:else}
				<div class="smoothie-ingredients">
					<FilterMultiSelect label="Ingredients" options={smoothieIngredients} bind:selected={ingredientChoice} emptyLabel="All ingredients" disabled={!hydrated} canSelect={(values) => hasMatches({ ingredients: values })} />
				</div>
			{/if}
		</div>
		{#if collection === "meal"}
			<div class="style-filter">
				<label for={mealStyleId}
					>Meal style<NativeSelect
						id={mealStyleId}
						value={carbChoice}
						disabled={!hydrated}
						onchange={(event) => {
							carbChoice = event.currentTarget.value;
						}}
						><option value="all">All meals</option>{#each Object.entries(carbStyles) as [value, label] (value)}<option {value} disabled={!hasMatches({ carb: [value] })}>{label}</option>{/each}</NativeSelect
					></label
				><small aria-live="polite">{mealStyleDescriptions[carbChoice]}</small>
			</div>
		{/if}
	</div>
	<fieldset class="inventory">
		<legend>Appliances on hand</legend>
		<!-- Keyboard focus lets users scroll the meals' appliance list; the
		     smoothies' single appliance needs no scrolling region. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<section class="inventory-options" class:simple-inventory={collection === "smoothie"} tabindex={collection === "meal" ? 0 : undefined} aria-label={collection === "meal" ? "Appliances on hand, scroll for more" : undefined}>
			{#each shownAppliances as [value, label], index (value)}
				{#if Object.hasOwn(applianceLimits, value)}
					<div class="inventory-count">
						<label for={controlId(`appliance-${index}`)}
							><Checkbox
								id={controlId(`appliance-${index}`)}
								checked={appliancesOnHand[value] > 0}
								onCheckedChange={(checked) => {
									appliancesOnHand = { ...appliancesOnHand, [value]: checked ? 1 : 0 };
								}}
								disabled={!hydrated}
							/><ApplianceIcon name={value} decorative />{label}</label
						><label class="visually-hidden" for={controlId(`count-${index}`)}>{label} count</label><NativeSelect
							id={controlId(`count-${index}`)}
							disabled={!hydrated}
							value={appliancesOnHand[value]}
							onchange={(event) => {
								appliancesOnHand = { ...appliancesOnHand, [value]: Number(event.currentTarget.value) };
							}}>{#each countChoices(value) as count (count)}<option value={count}>{count}</option>{/each}</NativeSelect
						>
					</div>
				{:else}
					<label for={controlId(`appliance-${index}`)}
						><Checkbox
							id={controlId(`appliance-${index}`)}
							checked={appliancesOnHand[value] > 0}
							onCheckedChange={() => {
								appliancesOnHand = { ...appliancesOnHand, [value]: appliancesOnHand[value] ? 0 : 1 };
							}}
							disabled={!hydrated || unavailable(value)}
						/><ApplianceIcon name={value} decorative />{label}</label
					>
				{/if}
			{/each}
		</section>
	</fieldset>
	<!-- The legend floats so it lines up with the help trigger beside it. -->
	<fieldset class="nutrient-filters">
		<legend>Nutrition</legend><NutritionHelp />
		<div class="nutrient-options">
			{#if collection === "smoothie"}<label for={controlId("keto")}><Checkbox id={controlId("keto")} bind:checked={smoothieKetoOnly} disabled={!hydrated || (!smoothieKetoOnly && !hasMatches({ carb: ["keto"] }))} /> Keto Friendly</label>{/if}<label
				for={controlId("immune")}
				title="At least 20% Daily Value in two or more of vitamins A, C, D, zinc and selenium per serving"
				><Checkbox id={controlId("immune")} bind:checked={immuneSupport} disabled={!hydrated || (!immuneSupport && !hasMatches({ immune: true }))} /> Immune support</label
			>{#if collectionHasIron}<label for={controlId("iron")} title="At least 20% Daily Value of iron per serving"><Checkbox id={controlId("iron")} bind:checked={ironRich} disabled={!hydrated || (!ironRich && !hasMatches({ iron: true }))} /> Iron-rich</label>{/if}<label
				for={controlId("omega")}
				title="At least 0.5 g recorded ALA, EPA, and DHA per meal serving or 8 oz smoothie glass"
				><Checkbox id={controlId("omega")} bind:checked={omega3} disabled={!hydrated || (!omega3 && !hasMatches({ omega: true }))} /> High in Omega-3s</label
			>
		</div>
	</fieldset>
	<Button variant="outline" type="button" class="print-all" disabled={!hydrated} onclick={onPrintAll}>{collection === "smoothie" ? "Print all smoothies" : "Print all meals"}</Button>
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
		.library-intro {
			display: grid;
			grid-template-columns: auto;
			align-items: center;
			gap: 24px;
			grid-column: 1 / -1;
		}
		.servings-setting {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.library-intro > .servings-setting {
			grid-column: 1;
			grid-row: 1;
		}
		.recipe-filter-selects {
			grid-column: 1 / -1;
			display: grid;
			gap: 16px;
		}
		.filter-fields {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 16px;
			min-height: 74px;
		}
		.smoothie-ingredients {
			grid-column: 1 / -1;
		}
		.style-filter {
			grid-column: 1 / -1;
			min-height: 104px;
		}
		.smoothie-filters .filter-fields {
			min-height: 0;
			height: auto;
		}
		.style-filter > label {
			display: block;
		}
		.style-filter :global(select) {
			margin-top: 6px;
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
			grid-column: 1;
			grid-row: 5;
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
		/* The attribute outranks the library's `button { font: inherit }`. */
		.library-controls :global([data-slot="button"].print-all) {
			align-self: end;
			justify-self: end;
			grid-column: 2;
			grid-row: 5;
			border: 1px solid var(--recipe-input-border);
			background: transparent;
			color: var(--recipe-ink);
			border-radius: 8px;
			padding: 8px 12px;
			font-size: 0.8rem;
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
				height: 164px;
				min-height: 164px;
				align-content: start;
			}
			.library-controls :global([data-slot="button"].print-all) {
				grid-column: 1 / -1;
				grid-row: 6;
				justify-self: end;
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
