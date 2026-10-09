<script>
	import { onMount, tick, untrack } from "svelte";
	import {
		BASE_SERVINGS,
		DEFAULT_FILTERS,
		defaultAppliances,
		STORAGE_KEY,
	} from "./constants.mjs";
	import LibraryControls from "./LibraryControls.svelte";
	import {
		matchesRecipe,
		nutrientFilters,
		parseSavedSettings,
		smoothieIngredientChoices,
	} from "./nutrient-filters.mjs";
	import RecipeCard from "./RecipeCard.svelte";
	import RecipePrint from "./RecipePrint.svelte";
	import RecipeTakeover from "./RecipeTakeover.svelte";
	import { shuffleRecipes, validateSettings } from "./recipe-logic.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL, recipeHref } from "./recipe-url.mjs";

	// The recipe library on /recipes/ and the meals and smoothies pages. The
	// server render lists the collection's recipes in recipes.json order with
	// every control disabled; on mount it restores the saved settings (J13:
	// localStorage key recipes-settings-v1), reads a share link or #<recipe-id>,
	// shuffles the cards and opens a linked recipe in a full-screen dialog.
	// `pathname` is the page's path, for the collection links' aria-current.
	let { recipes, initialCollection = "meal", pathname } = $props();
	const NO_RESULTS = "No recipes match these appliances and filters.";

	// The saved settings: servings, the filters, the appliances on hand and
	// each recipe's family side.
	let servings = $state(BASE_SERVINGS);
	let filters = $state({ ...DEFAULT_FILTERS });
	let appliancesOnHand = $state({ ...defaultAppliances });
	let familyChoice = $state({});

	let collection = $state(untrack(() => initialCollection));
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
	// recipes.json order until mount shuffles it, so the server render and
	// the first client render agree.
	let results = $state(untrack(() => recipes));

	const smoothieIngredients = $derived(smoothieIngredientChoices(recipes));
	const collectionRecipes = $derived(
		recipes.filter((recipe) => recipe.type === collection),
	);
	const collectionHasIron = $derived(
		collectionRecipes.some((recipe) => nutrientFilters(recipe, servings).iron),
	);
	const filterSettings = $derived({
		protein: collection === "meal" ? filters.proteinChoice : [],
		carb:
			collection === "smoothie"
				? filters.smoothieKetoOnly
					? ["keto"]
					: []
				: filters.mealStyle === "all"
					? []
					: [filters.mealStyle],
		starch: collection === "meal" ? filters.starchChoice : [],
		ingredients: collection === "smoothie" ? filters.ingredientChoice : [],
		immune: filters.immuneSupport,
		iron: filters.ironRich && collectionHasIron,
		omega: filters.omega3,
		appliances: appliancesOnHand,
	});
	const eligibleRecipes = $derived(
		collectionRecipes.filter((recipe) =>
			matchesRecipe(recipe, servings, filterSettings),
		),
	);
	const visibleRecipes = $derived(
		results.filter((recipe) => eligibleRecipes.includes(recipe)),
	);
	const current = $derived(recipes.find((recipe) => recipe.id === recipeId));
	// What the cards, the dialog and the print copy show each recipe with.
	const recipeSettings = $derived({
		servings,
		units: "us",
		familyDiners: servings,
		familyChoice,
	});
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
				recipe.type === value &&
				matchesRecipe(recipe, servings, {
					...filterSettings,
					appliances: defaultAppliances,
				}),
		);
		if (!matches) filters = { ...DEFAULT_FILTERS };
	}

	function setServings(value) {
		servings = validateSettings({ servings: Number(value) }).servings;
	}

	function setChoice(id, value) {
		familyChoice = { ...familyChoice, [id]: value };
	}

	async function openRecipe(id) {
		recipeId = id;
		setCollection(recipes.find((recipe) => recipe.id === id).type);
		lastOpenedId = id;
		message = "";
		if (window.location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
		await tick();
		if (detailHeading) {
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

	// Saved settings are preferences only; a missing, unreadable or stale
	// entry restores the defaults, key by key.
	function restoreSettings() {
		let saved = null;
		try {
			saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		} catch {
			// Reading remains usable without storage or with a corrupt entry.
		}
		({ servings, filters, appliancesOnHand, familyChoice } = parseSavedSettings(
			saved,
			{ recipes, ingredients: smoothieIngredients },
		));
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
		message = await printSession.print(tick);
	}

	onMount(() => {
		restoreSettings();
		readURL();
		setCollection(collection);
		results = shuffleRecipes(recipes);
		hydrated = true;
		if (recipeId) void openRecipe(recipeId);
		const stopPrint = printSession.listen();
		const hash = () => {
			const id = window.location.hash.slice(1);
			if (recipes.some((recipe) => recipe.id === id)) void openRecipe(id);
			else if (recipeId) void backToResults(false);
		};
		window.addEventListener("hashchange", hash);
		return () => {
			window.removeEventListener("hashchange", hash);
			stopPrint();
		};
	});

	// Saves the shape parseSavedSettings reads.
	$effect(() => {
		if (!hydrated) return;
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ servings, filters, appliancesOnHand, familyChoice }),
			);
		} catch {
			// No persistence required to cook.
		}
	});
</script>

<section class="meal-library" data-hydrated={hydrated} data-print-prepared={printPrepared} bind:this={libraryElement} aria-label="Easy Meals & Smoothies recipe library">
	<LibraryControls
		{collection}
		{pathname}
		{hydrated}
		{servings}
		onServingsChange={setServings}
		{collectionRecipes}
		{collectionHasIron}
		{smoothieIngredients}
		{hasMatches}
		onPrintAll={() => print("all")}
		bind:filters
		bind:appliancesOnHand
	/>

	<div class="browse" id="meal-results">
		<h2 bind:this={listHeading} tabindex="-1">{collection === "smoothie" ? "Find your smoothie" : "Find your meal"}</h2>
		<div class="recipe-grid">
			{#each visibleRecipes as recipe (recipe.id)}
				<RecipeCard {recipe} {servings} href={recipeHref(recipe, recipeSettings)} />
			{/each}
		</div>
		<p class="no-results" role="status">{hydrated && !visibleRecipes.length ? NO_RESULTS : ""}</p>
	</div>

	{#if current}
		<RecipeTakeover recipe={current} settings={recipeSettings} onBack={() => backToResults()} onPrint={() => print("recipe")} onSideChange={(value) => setChoice(current.id, value)} bind:heading={detailHeading} bind:dialog={recipeDialog} />
	{/if}

	<p class="action-status" role="status" aria-live="polite">{message}</p>
	<div class="print-output"><RecipePrint recipes={printRecipes} settings={recipeSettings} /></div>
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
		.browse {
			scroll-margin-top: 1rem;
		}

		.recipe-grid {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 18px;
		}
		.no-results:empty {
			margin: 0;
		}
		.action-status {
			font-size: 0.85rem;
			color: var(--recipe-accent);
		}
		.print-output {
			display: none;
		}
		:global([data-slot="dialog-overlay"]) {
			background: #0008;
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
			.recipe-grid {
				grid-template-columns: 1fr;
				gap: 14px;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.meal-library :global(*) {
				scroll-behavior: auto;
			}
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
			/* The controls are another component's root, hence :global. */
			.meal-library > :global(:not(.print-output)) {
				display: none;
			}
			:global([data-slot="dialog-overlay"]) {
				display: none;
			}
			.meal-library > .print-output {
				display: block;
			}
		}
	}
</style>
