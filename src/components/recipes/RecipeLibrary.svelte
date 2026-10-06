<script>
	import { onMount, tick, untrack } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import DialogRoot from "../../lib/components/ui/dialog.svelte";
	import DialogContent from "../../lib/components/ui/dialog-content.svelte";
	import DialogDescription from "../../lib/components/ui/dialog-description.svelte";
	import DialogTitle from "../../lib/components/ui/dialog-title.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import {
		applianceChoices,
		BASE_SERVINGS,
		defaultAppliances,
		groupBadges,
		SERVING_CHOICES,
		starchTypes,
	} from "./constants.mjs";
	import FilterMultiSelect from "./FilterMultiSelect.svelte";
	import NutritionHelp from "./NutritionHelp.svelte";
	import {
		availableAppliances,
		matchesRecipe,
		normalizeMealStyles,
		normalizeSelection,
		nutrientFilters,
		smoothieIngredientChoices,
	} from "./nutrient-filters.mjs";
	import RecipeBody from "./RecipeBody.svelte";
	import RecipePrint from "./RecipePrint.svelte";
	import {
		servingNutrition,
		shuffleRecipes,
		smoothiePortionNutrition,
		validateSettings,
	} from "./recipe-logic.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL, recipeHref } from "./recipe-url.mjs";
	import ShareRecipe from "./ShareRecipe.svelte";

	// The recipe library on /recipes/ and the meals and smoothies pages. The
	// server render lists the collection's recipes in recipes.json order with
	// every control disabled; on mount it restores the saved settings (J13:
	// localStorage key recipes-settings-v1), reads a share link or #<recipe-id>,
	// shuffles the cards and opens a linked recipe in a full-screen dialog.
	let { recipes, initialCollection = "meal" } = $props();
	const STORAGE_KEY = "recipes-settings-v1";
	const NO_RESULTS = "No recipes match these appliances and filters.";
	const PRINT_FAILED =
		"Printing could not open. Use your browser’s Print command.";
	const proteins = {
		chicken: "Chicken",
		fish: "Fish",
		turkey: "Turkey",
		vegetarian: "Vegetarian",
		"plant-forward": "Plant-forward",
	};
	const carbStyles = { keto: "Keto", nonketo: "Not Keto", shared: "Shared Main" };
	const mealStyleDescriptions = {
		all: "Keto meals, higher-carb meals, and shared mains with different sides.",
		keto: "Low-carb meals without a starchy side.",
		nonketo: "Meals with over 50g net carbs per four servings.",
		shared: "One main dish with different sides for keto and non-keto diners.",
	};
	// The appliances counted rather than ticked.
	const COUNTED_APPLIANCES = ["Instant Pot", "Two air fryers"];
	const APPLIANCE_COUNTS = [0, 1, 2];
	const starchOptions = Object.fromEntries(
		Object.entries(starchTypes).filter(
			([key]) => !["all", "none"].includes(key),
		),
	);
	const servingsId = $props.id();
	const mealStyleId = `${servingsId}-meal-style`;
	const checkId = (name) => `${servingsId}-${name}`;
	const units = "us";

	let servings = $state(BASE_SERVINGS);
	const familyDiners = $derived(servings);
	let familyChoice = $state({});
	let recipeId = $state("");
	let hydrated = $state(false);
	let printMode = $state("auto");
	let printPrepared = $state(false);
	let libraryElement = $state(null);
	let message = $state("");
	let detailHeading = $state(null);
	let recipeDialog = $state(null);
	let lastOpenedId = "";
	let listHeading = $state(null);
	let results = $state([]);
	let immuneSupport = $state(false);
	let ironRich = $state(false);
	let omega3 = $state(false);
	let proteinChoice = $state([]);
	let carbChoice = $state([]);
	let smoothieKetoOnly = $state(false);
	let starchChoice = $state([]);
	let ingredientChoice = $state([]);
	let appliancesOnHand = $state({ ...defaultAppliances });
	let collection = $state(untrack(() => initialCollection));

	const smoothieIngredients = $derived(smoothieIngredientChoices(recipes));
	const collectionRecipes = $derived(
		recipes.filter((recipe) => (recipe.type || "meal") === collection),
	);
	const collectionHasIron = $derived(
		collectionRecipes.some((recipe) => nutrientFilters(recipe, servings).iron),
	);
	const filterSettings = $derived({
		protein: collection === "meal" ? proteinChoice : [],
		carb:
			collection === "smoothie"
				? smoothieKetoOnly
					? ["keto"]
					: []
				: carbChoice,
		starch: collection === "meal" ? starchChoice : [],
		ingredients: collection === "smoothie" ? ingredientChoice : [],
		immune: immuneSupport,
		iron: ironRich && collectionHasIron,
		omega: omega3,
		appliances: appliancesOnHand,
	});
	const eligibleRecipes = $derived(
		collectionRecipes.filter((recipe) =>
			matchesRecipe(recipe, servings, filterSettings),
		),
	);
	const visibleRecipes = $derived(
		(hydrated ? results : recipes).filter((recipe) =>
			eligibleRecipes.includes(recipe),
		),
	);
	const shownAppliances = $derived(
		Object.entries(applianceChoices).filter(([value]) =>
			collectionRecipes.some((recipe) =>
				recipe.appliancesNeeded.includes(value),
			),
		),
	);
	const current = $derived(recipes.find((recipe) => recipe.id === recipeId));
	const printSettings = $derived({ servings, units, familyDiners, familyChoice });
	const effectivePrintMode = $derived(
		printMode === "auto" ? (current ? "recipe" : "all") : printMode,
	);
	const printRecipes = $derived(
		effectivePrintMode === "recipe" && current ? [current] : collectionRecipes,
	);

	function hasMatches(overrides) {
		return collectionRecipes.some((recipe) =>
			matchesRecipe(recipe, servings, { ...filterSettings, ...overrides }),
		);
	}

	// Switching collection keeps the filters only while some recipe of the new
	// collection still matches them with every appliance on hand.
	function setCollection(value) {
		collection = value;
		const matches = recipes.some(
			(recipe) =>
				(recipe.type || "meal") === value &&
				matchesRecipe(recipe, servings, {
					...filterSettings,
					appliances: defaultAppliances,
				}),
		);
		if (!matches) {
			proteinChoice = [];
			starchChoice = [];
			ingredientChoice = [];
			carbChoice = [];
			smoothieKetoOnly = false;
			immuneSupport = false;
			ironRich = false;
			omega3 = false;
		}
	}

	function setServings(value) {
		servings = validateSettings({
			servings: Number(value),
			familyDiners,
			units,
		}).servings;
	}

	function setChoice(id, value) {
		familyChoice = { ...familyChoice, [id]: value };
	}

	async function openRecipe(id, scroll = true) {
		recipeId = id;
		setCollection(recipes.find((recipe) => recipe.id === id)?.type || "meal");
		lastOpenedId = id;
		message = "";
		if (window.location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
		await tick();
		if (scroll && detailHeading) {
			detailHeading.focus({ preventScroll: true });
			recipeDialog.scrollTop = 0;
		}
	}

	async function backToResults(updateURL = true) {
		recipeId = "";
		if (updateURL) history.pushState(null, "", "#meal-results");
		await tick();
		const trigger = libraryElement?.querySelector(
			`[data-recipe-id="${lastOpenedId}"]`,
		);
		(trigger || listHeading)?.focus({ preventScroll: true });
		if (trigger) trigger.scrollIntoView({ block: "center" });
		else listHeading?.scrollIntoView({ block: "start" });
	}

	function readURL() {
		const parsed = readRecipeURL(new URL(window.location.href), recipes, {
			servings,
		});
		servings = parsed.servings;
		familyChoice = { ...familyChoice, ...parsed.familyChoice };
		recipeId = parsed.recipeId;
	}

	// Saved settings are preferences only; a missing or unreadable entry leaves
	// the defaults.
	function restoreSettings() {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		if (!saved || typeof saved !== "object") return;
		servings = validateSettings(saved).servings;
		collection = initialCollection;
		proteinChoice = normalizeSelection(saved.proteinChoice, proteins);
		carbChoice = normalizeMealStyles(saved.carbChoice).slice(0, 1);
		smoothieKetoOnly = saved.smoothieKetoOnly === true;
		appliancesOnHand = availableAppliances(saved.appliancesOnHand);
		starchChoice = normalizeSelection(saved.starchChoice, starchOptions);
		ingredientChoice = normalizeSelection(
			saved.ingredientChoice,
			smoothieIngredients,
		);
		immuneSupport = saved.immuneSupport === true;
		ironRich = saved.ironRich === true;
		omega3 = saved.omega3 === true;
		familyChoice =
			saved.familyChoice && typeof saved.familyChoice === "object"
				? saved.familyChoice
				: {};
	}

	const printSession = createRecipePrintSession(
		() => effectivePrintMode,
		() => {
			printPrepared = true;
		},
		() => {
			printPrepared = false;
			printMode = "auto";
		},
	);

	async function print(target) {
		printMode = target;
		await tick();
		printSession.prepare();
		await tick();
		try {
			window.print();
		} catch {
			printSession.restore();
			message = PRINT_FAILED;
		}
	}

	onMount(() => {
		try {
			restoreSettings();
		} catch {
			// Reading remains usable without storage.
		}
		readURL();
		setCollection(collection);
		results = shuffleRecipes(recipes);
		hydrated = true;
		if (recipeId) void openRecipe(recipeId);
		const stopPrint = printSession.listen();
		const hash = () => {
			const id = window.location.hash.slice(1);
			if (recipes.some((recipe) => recipe.id === id)) void openRecipe(id, true);
			else if (recipeId) void backToResults(false);
		};
		window.addEventListener("hashchange", hash);
		return () => {
			window.removeEventListener("hashchange", hash);
			stopPrint();
		};
	});

	$effect(() => {
		if (!hydrated) return;
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					servings,
					familyDiners,
					units,
					familyChoice,
					immuneSupport,
					ironRich,
					omega3,
					proteinChoice,
					carbChoice,
					smoothieKetoOnly,
					starchChoice,
					ingredientChoice,
					appliancesOnHand,
					collection,
				}),
			);
		} catch {
			// No persistence required to cook.
		}
	});
</script>

<section class="meal-library" data-hydrated={hydrated} data-print-prepared={printPrepared} bind:this={libraryElement} aria-label="Easy Meals & Smoothies recipe library">
	<div class="library-controls">
		<nav class="collection-options" aria-label="Recipe type"
			><a href="/recipes/meals/" aria-current={collection === "meal" ? "page" : undefined}>Meals</a><a href="/recipes/smoothies/" aria-current={collection === "smoothie" ? "page" : undefined}>Smoothies</a></nav
		>
		<div class="library-intro">
			<label class="servings-setting" for={servingsId}
				>Servings<NativeSelect id={servingsId} value={servings} onchange={(event) => setServings(event.currentTarget.value)} disabled={!hydrated}
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
							value={carbChoice[0] || "all"}
							disabled={!hydrated}
							onchange={(event) => {
								carbChoice = event.currentTarget.value === "all" ? [] : [event.currentTarget.value];
							}}
							><option value="all">All meals</option>{#each Object.entries(carbStyles) as [value, label] (value)}<option {value} disabled={!hasMatches({ carb: [value] })}>{label}</option>{/each}</NativeSelect
						></label
					><small aria-live="polite">{mealStyleDescriptions[carbChoice[0] || "all"]}</small>
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
					{#if COUNTED_APPLIANCES.includes(value)}
						<!-- The label holds the check and the count, so each names its own. -->
						<label class="inventory-count" for={checkId(`appliance-${index}`)}
							><Checkbox
								id={checkId(`appliance-${index}`)}
								aria-label={label}
								checked={appliancesOnHand[value] > 0}
								onCheckedChange={(checked) => {
									appliancesOnHand = { ...appliancesOnHand, [value]: checked ? 1 : 0 };
								}}
								disabled={!hydrated}
							/><ApplianceIcon name={value} decorative />{label}<NativeSelect
								aria-label={`${label} count`}
								disabled={!hydrated}
								value={appliancesOnHand[value]}
								onchange={(event) => {
									appliancesOnHand = { ...appliancesOnHand, [value]: Number(event.currentTarget.value) };
								}}>{#each APPLIANCE_COUNTS as count (count)}<option value={count}>{count}</option>{/each}</NativeSelect
							></label
						>
					{:else}
						<label for={checkId(`appliance-${index}`)}
							><Checkbox
								id={checkId(`appliance-${index}`)}
								checked={appliancesOnHand[value] > 0}
								onCheckedChange={() => {
									appliancesOnHand = { ...appliancesOnHand, [value]: appliancesOnHand[value] ? 0 : 1 };
								}}
								disabled={!hydrated || (value === "Pans" && !appliancesOnHand.Oven)}
							/><ApplianceIcon name={value} decorative />{label}</label
						>
					{/if}
				{/each}
			</section>
		</fieldset>
		<fieldset class="nutrient-filters">
			<legend>Nutrition<NutritionHelp /></legend>{#if collection === "smoothie"}<label for={checkId("keto")}><Checkbox id={checkId("keto")} bind:checked={smoothieKetoOnly} disabled={!hydrated || (!smoothieKetoOnly && !hasMatches({ carb: ["keto"] }))} /> Keto Friendly</label>{/if}<label
				for={checkId("immune")}
				title="At least 20% Daily Value in two or more of vitamins A, C, D, zinc and selenium per serving"
				><Checkbox id={checkId("immune")} bind:checked={immuneSupport} disabled={!hydrated || (!immuneSupport && !hasMatches({ immune: true }))} /> Immune support</label
			>{#if collectionHasIron}<label for={checkId("iron")} title="At least 20% Daily Value of iron per serving"><Checkbox id={checkId("iron")} bind:checked={ironRich} disabled={!hydrated || (!ironRich && !hasMatches({ iron: true }))} /> Iron-rich</label>{/if}<label
				for={checkId("omega")}
				title="At least 0.5 g recorded ALA, EPA, and DHA per meal serving or 8 oz smoothie glass"
				><Checkbox id={checkId("omega")} bind:checked={omega3} disabled={!hydrated || (!omega3 && !hasMatches({ omega: true }))} /> High in Omega-3s</label
			>
		</fieldset>
		<Button variant="ghost" type="button" class="outline print-all" disabled={!hydrated} onclick={() => print("all")}>{collection === "smoothie" ? "Print all smoothies" : "Print all meals"}</Button>
	</div>

	<div class="browse" id="meal-results">
		<h2 bind:this={listHeading} tabindex="-1">{collection === "smoothie" ? "Find your smoothie" : "Find your meal"}</h2>
		<div class="recipe-grid">
			{#each visibleRecipes as recipe (recipe.id)}
				<article class="recipe-card">
					<div class="card-top"><span class="badge" class:shared={recipe.group === "shared"} class:nonketo={recipe.group === "nonketo"}>{groupBadges[recipe.group]}</span></div>
					{#if recipe.image}<figure class="card-photo"><img src={recipe.image.cardSrc} srcset={recipe.image.cardSrcset} sizes="(max-width:600px) 340px, (max-width:1000px) 420px, 360px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="lazy" decoding="async" /></figure>{/if}
					<h3><a class="title-button" data-recipe-id={recipe.id} href={recipeHref(recipe, printSettings)}>{recipe.title}</a></h3>
					<dl class="card-numbers">
						<div>
							<dt>Active time</dt>
							<dd class="active-time"><span class="time-number">{recipe.activeMinutes}{servings > BASE_SERVINGS ? "+" : ""}</span><span class="time-unit">min</span></dd>
						</div>
						<div>
							<dt>{recipe.type === "smoothie" ? "Net Carbs (8 oz)" : `Net carbs per ${servings} servings`}</dt>
							<dd>{recipe.type === "smoothie" ? smoothiePortionNutrition(recipe).net_carbs_g.toFixed(1) : Math.round(servingNutrition(recipe, servings).net_carbs_g * servings)} g</dd>
						</div>
						<div>
							<dt>Appliances needed</dt>
							<dd class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name} />{/each}</dd>
						</div>
					</dl>
					<div class="card-actions"><a class="open-button" href={recipeHref(recipe, printSettings)}>See recipe</a></div>
				</article>
			{/each}
		</div>
		<p class="no-results" role="status">{hydrated && !visibleRecipes.length ? NO_RESULTS : ""}</p>
	</div>

	{#if current}
		<DialogRoot
			open={Boolean(current)}
			onOpenChange={(open) => {
				if (!open) void backToResults();
			}}
			><DialogContent
				class="recipe-takeover"
				bind:ref={recipeDialog}
				showCloseButton={false}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					detailHeading?.focus({ preventScroll: true });
				}}
				onCloseAutoFocus={(event) => event.preventDefault()}
				><section class="recipe-detail" id={current.id} aria-labelledby="recipe-detail-title">
					<div class="detail-toolbar"><Button variant="ghost" type="button" class="text-button" onclick={() => backToResults()}>← Back to recipes</Button><Button variant="ghost" type="button" class="outline" onclick={() => print("recipe")}>Print recipe</Button></div>
					<span class="badge" class:shared={current.group === "shared"} class:nonketo={current.group === "nonketo"}>{groupBadges[current.group]}</span>
					<DialogTitle id="recipe-detail-title" tabindex={-1} bind:ref={detailHeading}>{current.title}</DialogTitle>
					<DialogDescription class="detail-summary">{current.summary}</DialogDescription>
					<RecipeBody recipe={current} settings={printSettings} onSideChange={(value) => setChoice(current.id, value)} />
					<ShareRecipe recipe={current} settings={printSettings} />
				</section></DialogContent
			></DialogRoot
		>
	{/if}

	<p class="action-status" role="status" aria-live="polite">{message}</p>
	<div class="print-output"><RecipePrint recipes={printRecipes} settings={printSettings} /></div>
</section>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.meal-library {
			background: var(--recipe-canvas);
			border-radius: 16px;
			padding: 18px;
			container-type: inline-size;
			color: var(--recipe-ink);
			font: 16px/1.55 var(--font-body);
			min-width: 0;
		}
		.meal-library :global(*) {
			box-sizing: border-box;
		}
		.meal-library :global(button),
		.meal-library :global(input),
		.meal-library :global(select) {
			font: inherit;
		}
		.meal-library :global(button),
		.meal-library :global(select) {
			min-height: 44px;
		}
		.meal-library :global(button) {
			cursor: pointer;
		}
		.meal-library :global(button:disabled) {
			cursor: default;
			opacity: 0.7;
		}
		.meal-library :global(a) {
			color: var(--recipe-accent);
			text-underline-offset: 3px;
		}
		.meal-library :global(:focus-visible) {
			outline: 3px solid var(--recipe-focus);
			outline-offset: 3px;
		}
		.meal-library :global(h2:focus) {
			outline: none;
		}
		.meal-library :global(h1),
		.meal-library :global(h2),
		.meal-library :global(h3) {
			line-height: 1.18;
			letter-spacing: -0.035em;
			color: var(--recipe-ink);
		}
		.meal-library :global(h2) {
			font-size: clamp(1.6rem, 3vw, 2.1rem);
			margin: 0 0 0.8rem;
		}
		.meal-library :global(h3) {
			font-size: 1.2rem;
		}
		.meal-library :global(p) {
			margin: 0.65rem 0 1rem;
		}
		.meal-library :global(label) {
			font-size: 0.86rem;
			font-weight: 600;
		}
		.meal-library :global(input[type="checkbox"]) {
			width: 19px;
			height: 19px;
			min-height: 19px;
			accent-color: var(--recipe-accent);
			flex-shrink: 0;
		}
		/* Muted ink keeps a control's boundary at 3:1 or more. */
		.meal-library :global(select) {
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			border: 1px solid var(--recipe-muted);
			border-radius: 8px;
			padding: 10px;
			max-width: 100%;
			min-width: 0;
			display: block;
			width: 100%;
		}
		.meal-library :global(summary) {
			cursor: pointer;
			font-weight: 650;
			min-height: 44px;
			padding: 10px 0;
		}
		.meal-library :global(details p),
		.meal-library :global(details li) {
			font-size: 0.95rem;
		}
		.meal-library :global(details) {
			border-top: 1px solid var(--recipe-line);
		}
		.meal-library :global(small) {
			display: block;
			font-size: 0.77rem;
			font-weight: 400;
			color: var(--recipe-muted);
			line-height: 1.45;
			margin-top: 3px;
		}
		.meal-library :global(ul) {
			padding-left: 1.25rem;
		}
		.meal-library :global(li) {
			margin: 0.35rem 0;
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
		.collection-options a {
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
		.collection-options a[aria-current="page"] {
			background: var(--recipe-accent);
			color: var(--recipe-accent-text);
		}
		/* Later than the library's select rule, which it overrides. */
		.inventory-count :global(select) {
			width: 65px;
			display: inline-block;
		}
		.inventory label:has(:global(:disabled)),
		.nutrient-filters label:has(:global(:disabled)) {
			opacity: 0.45;
			cursor: not-allowed;
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
		.inventory label {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 44px;
			padding: 4px 0;
		}
		.inventory-count :global([data-slot="native-select-wrapper"]) {
			margin-left: auto;
		}
		.nutrient-filters {
			border: 0;
			padding: 0;
			margin: 0;
			display: flex;
			align-items: center;
			gap: 8px 20px;
			flex-wrap: wrap;
			grid-column: 1;
			grid-row: 5;
		}
		.nutrient-filters legend {
			display: flex;
			width: auto;
			align-items: center;
			font-size: 0.8rem;
			font-weight: 650;
			margin-bottom: 0;
			padding: 0;
		}
		.nutrient-filters label {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 44px;
		}
		/* The nutrition help trigger is smaller than the library's buttons. */
		.nutrient-filters :global(.nutrition-info) {
			min-height: 32px;
		}
		.library-intro {
			display: grid;
			grid-template-columns: auto;
			align-items: center;
			gap: 24px;
			grid-column: 1 / -1;
		}
		.library-controls :global(.print-all) {
			align-self: end;
			justify-self: end;
			grid-column: 2;
			grid-row: 5;
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
		.servings-setting :global(select) {
			width: 72px;
			min-width: 72px;
			padding-right: 32px;
			appearance: none;
		}
		:global(.recipe-takeover .text-button) {
			border: 0;
			background: transparent;
			color: var(--recipe-accent);
			padding: 8px 3px;
			font-size: 0.85rem;
		}
		.recipe-grid {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 18px;
		}
		.recipe-card {
			background: var(--recipe-paper);
			border: 1px solid var(--recipe-line);
			border-radius: 16px;
			display: grid;
			grid-template-rows: subgrid;
			grid-row: span 5;
			padding: 20px;
			min-width: 0;
			row-gap: 0;
		}
		.card-top {
			display: flex;
			justify-content: space-between;
			gap: 10px;
			align-items: center;
		}
		.badge {
			font-size: 0.69rem;
			text-transform: uppercase;
			letter-spacing: 0.055em;
			font-weight: 750;
			border-radius: 6px;
			padding: 4px 7px;
			background: var(--recipe-badge);
		}
		.badge.shared {
			background: var(--recipe-badge-shared);
		}
		.badge.nonketo {
			background: var(--recipe-badge-nonketo);
		}
		.recipe-card h3 {
			margin: 18px 0 8px;
		}
		.title-button {
			display: block;
			font: 600 1.5rem / 1.18 var(--font-heading);
			color: var(--recipe-ink);
		}
		.title-button:hover {
			text-decoration: underline;
			text-underline-offset: 4px;
		}
		.card-numbers {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 12px;
			border-top: 1px solid var(--recipe-line);
			padding-top: 13px;
			margin: 12px 0 0;
		}
		.card-numbers > div {
			display: grid;
			grid-template-rows: 1fr auto;
		}
		.card-numbers > div:last-child {
			grid-column: 1 / -1;
		}
		.card-numbers dt {
			font-size: 0.68rem;
			color: var(--recipe-muted);
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		.card-numbers dd {
			font-size: 0.86rem;
			font-weight: 650;
			margin: 4px 0 0;
		}
		.card-numbers .active-time {
			display: flex;
			align-items: baseline;
			gap: 6px;
		}
		.time-number {
			font-size: 2.4rem;
			line-height: 1.1;
			font-weight: 700;
			letter-spacing: -0.04em;
		}
		.time-unit {
			font-size: 1rem;
			font-weight: 600;
		}
		.appliance-icons {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.card-actions {
			margin-top: 16px;
			display: flex;
			justify-content: space-between;
			align-items: center;
			border-top: 1px solid var(--recipe-line);
			padding-top: 12px;
			gap: 10px;
		}
		.open-button {
			font-weight: 700;
			font-size: 0.84rem;
		}
		.no-results:empty {
			margin: 0;
		}
		/* bits-ui portals the dialog to <body>, outside the library. It takes
		   the whole viewport without the dialog's open and close animation. */
		:global(.recipe-takeover) {
			font: 16px/1.55 var(--font-body);
			position: fixed;
			inset: 0;
			transform: none;
			translate: none;
			animation: none;
			display: block;
			box-shadow: none;
			border-radius: 0;
			width: 100%;
			height: 100dvh;
			max-width: none;
			max-height: none;
			margin: 0;
			border: 0;
			padding: 24px;
			background: var(--recipe-canvas);
			color: var(--recipe-ink);
			overflow: auto;
			overscroll-behavior: contain;
		}
		.recipe-detail {
			max-width: 1100px;
			margin: 0 auto;
			padding: 28px;
			background: var(--recipe-paper);
			border: 1px solid var(--recipe-line);
			border-radius: 20px;
			scroll-margin-top: 20px;
		}
		.detail-toolbar {
			display: flex;
			justify-content: space-between;
			gap: 14px;
			margin-bottom: 24px;
		}
		/* The print buttons sit in the library and in the portaled dialog; the
		   library's own button font is inherited, so it is outranked here. */
		.meal-library :global(.outline),
		:global(.recipe-takeover .outline) {
			border: 1px solid var(--recipe-input-border);
			background: transparent;
			color: var(--recipe-ink);
			border-radius: 8px;
			padding: 8px 12px;
			font-size: 0.8rem;
		}
		.recipe-detail > .badge {
			display: inline-block;
			margin-bottom: 12px;
		}
		.recipe-detail :global(h2) {
			font: 600 clamp(2rem, 4vw, 3rem) / 1.13 var(--font-heading);
			max-width: 800px;
		}
		.recipe-detail :global(.detail-summary) {
			max-width: 700px;
			color: var(--recipe-muted);
		}
		.action-status {
			font-size: 0.85rem;
			color: var(--recipe-accent);
		}
		@container (max-width: 1000px) {
			.recipe-grid {
				grid-template-columns: repeat(2, minmax(0, 1fr));
			}
		}
		@container (max-width: 600px) {
			.recipe-grid {
				grid-template-columns: 1fr;
			}
		}
		@media (max-width: 1000px) {
			.recipe-grid {
				grid-template-columns: repeat(2, minmax(0, 1fr));
			}
		}
		@media (max-width: 600px) {
			.meal-library {
				padding: 12px;
			}
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
			.library-controls :global(.print-all) {
				grid-column: 1 / -1;
				grid-row: 6;
				justify-self: end;
			}
			.library-intro > .servings-setting {
				grid-column: 1;
				grid-row: 1;
			}
			.nutrient-filters {
				gap: 4px 12px;
				grid-column: 1 / -1;
			}
			.recipe-grid {
				grid-template-columns: 1fr;
				gap: 14px;
			}
			.recipe-card {
				padding: 18px;
			}
			.recipe-card h3 {
				margin-top: 15px;
			}
			:global(.recipe-takeover) {
				padding: 12px;
			}
			.recipe-detail {
				padding: 18px;
				border-radius: 14px;
			}
			.detail-toolbar {
				flex-direction: column;
				margin-bottom: 18px;
				gap: 5px;
			}
			.detail-toolbar :global(.outline) {
				padding: 7px 9px;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.meal-library :global(*) {
				scroll-behavior: auto;
			}
		}
		.print-output {
			display: none;
		}
		.card-photo {
			margin: 14px 0 0;
		}
		.card-photo img {
			display: block;
			width: 100%;
			height: auto;
			border-radius: 10px;
		}
		/* The bits-ui checks (each a <button>) drawn as checkboxes rather than the
		   blog's button pill, filled only when checked. */
		.meal-library :global([data-slot="checkbox"]) {
			width: 19px;
			height: 19px;
			min-height: 19px;
			padding: 0;
			border: 1px solid var(--recipe-muted);
			border-radius: 4px;
			color: var(--recipe-accent-text);
			background: var(--recipe-paper);
			flex-shrink: 0;
		}
		.meal-library :global([data-slot="checkbox"][data-state="checked"]) {
			border-color: var(--recipe-accent);
			background: var(--recipe-accent);
		}
		.meal-library :global([data-slot="native-select-wrapper"]) {
			width: auto;
			max-width: 100%;
		}
		.meal-library :global([data-slot="native-select"]) {
			background-image: none;
			height: auto;
		}
		:global([data-slot="dialog-overlay"]) {
			background: #0008;
		}
		@media print {
			@page {
				size: auto;
				margin: 15mm;
			}
			.meal-library {
				display: block;
				container-type: normal;
				padding: 0;
				margin: 0;
				border: 0;
				border-radius: 0;
				background: white;
				color: black;
			}
			.meal-library > :not(.print-output) {
				display: none;
			}
			:global(.recipe-takeover),
			:global([data-slot="dialog-overlay"]) {
				display: none;
			}
			.meal-library > .print-output {
				display: block;
			}
			.card-photo {
				display: none;
			}
		}
	}
</style>
