<script>
	import Shuffle from "@lucide/svelte/icons/shuffle";
	import { flushSync, onMount, tick, untrack } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import {
		BASE_SERVINGS,
		DEFAULT_FILTERS,
		defaultAppliances,
		RECIPE_BATCH_SIZE,
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
import RecipeDownload from "./RecipeDownload.svelte";
	import RecipePrint from "./RecipePrint.svelte";
	import RecipeTakeover from "./RecipeTakeover.svelte";
	import { shuffleRecipes, validateSettings } from "./recipe-logic.mjs";
	import { listVisit } from "./recipe-navigation.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { createRecipeSearch } from "./recipe-search.mjs";
	import { readRecipeURL, recipeHref } from "./recipe-url.mjs";
	import data from "./recipes.json" with { type: "json" };
	import { replaceUnitURL } from "./unit-preference.mjs";

	const recipes = data.recipes;

	// The recipe library on /recipes/ and the meals and smoothies pages. The
	// server render lists the collection's recipes in the build's order with
	// every control disabled; on mount it restores the saved settings (J13:
	// localStorage key recipes-settings-v1), reads a share link or #<recipe-id>,
	// opens a linked recipe in a full-screen dialog.
	// `pathname` is the page's path, for the collection links' aria-current.
	let { initialCollection = "meal", pathname } = $props();
	const NO_RESULTS = "No recipes match your search and filters. Try fewer words or adjust the filters.";
	let query = $state("");
	let printRecipeId = $state("");

	// The saved settings: servings, the filters, the appliances on hand and
	// each recipe's family side.
	let servings = $state(BASE_SERVINGS);
	let units = $state("us");
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

	const smoothieIngredients = $derived(smoothieIngredientChoices(recipes));
	const collectionRecipes = $derived(
		recipes.filter((recipe) => recipe.type === collection),
	);
	// Discovery order belongs to the cards; print packets keep source order.
	const recipesById = $derived(new Map(recipes.map((recipe) => [recipe.id, recipe])));
	let shuffledOrder = $state(null);
	const shuffledRanks = $derived(shuffledOrder ? new Map(shuffledOrder.map((id, rank) => [id, rank])) : null);
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
				: ["all", "vegetarian"].includes(filters.mealStyle)
					? []
					: [filters.mealStyle],
		vegetarian: collection === "meal" && filters.mealStyle === "vegetarian",
		dumpAndGo: collection === "meal" && filters.dumpAndGo,
		starch: collection === "meal" ? filters.starchChoice : [],
		ingredients: collection === "smoothie" ? filters.ingredientChoice : [],
		immune: filters.immuneSupport,
		iron: filters.ironRich && collectionHasIron,
		omega: filters.omega3,
		appliances: appliancesOnHand,
	});
	const searchRecipes = $derived(createRecipeSearch(recipes, servings));
	const searchedRecipes = $derived(query.trim() ? searchRecipes(query) : recipes);
	const matchingRecipes = $derived(
		searchedRecipes.filter((recipe) =>
			recipe.type === collection && matchesRecipe(recipe, servings, filterSettings),
		),
	);
	const visibleRecipes = $derived(shuffledRanks ? matchingRecipes.toSorted((a, b) => shuffledRanks.get(a.id) - shuffledRanks.get(b.id)) : matchingRecipes);
	let page = $state({ key: "", limit: RECIPE_BATCH_SIZE });
	const browseKey = $derived(JSON.stringify([collection, query, filterSettings, shuffledOrder]));
	const cardLimit = $derived(page.key === browseKey ? page.limit : RECIPE_BATCH_SIZE);
	const renderedRecipes = $derived(hydrated ? visibleRecipes.slice(0, cardLimit) : visibleRecipes);
	let shuffling = $state(false);
	let skeleton = $state(null);
	let shuffleAnimation;
	function loadMore() {
		page = { key: browseKey, limit: Math.min(recipes.length, cardLimit + RECIPE_BATCH_SIZE) };
	}
	async function loadMoreCards() {
		const firstNewCard = renderedRecipes.length;
		loadMore();
		await tick();
		libraryElement?.querySelectorAll(".recipe-card .title-button")[firstNewCard]?.focus();
	}
	function watchMore(node) {
		if (!("IntersectionObserver" in window)) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) loadMore();
		}, { rootMargin: "300px" });
		observer.observe(node);
		return () => observer.disconnect();
	}
	async function shuffleCards() {
		if (shuffling) return;
		shuffling = true;
		await tick();
		try {
			if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && skeleton) {
				shuffleAnimation = skeleton.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
				await shuffleAnimation.finished;
			}
			shuffledOrder = shuffleRecipes(recipes).map((recipe) => recipe.id);
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
		} finally { shuffling = false; shuffleAnimation = undefined; }
	}
	const current = $derived(recipes.find((recipe) => recipe.id === recipeId));
	// What the cards, the dialog and the print copy show each recipe with.
	const recipeSettings = $derived({
		servings,
		units,
		familyDiners: servings,
		familyChoice,
	});
	const effectivePrintMode = $derived(
		printMode === "auto" ? (current ? "recipe" : "all") : printMode,
	);
	const printRecipes = $derived(
		effectivePrintMode === "recipe" && (printRecipeId || current)
			? [printRecipeId ? recipesById.get(printRecipeId) : current] : collectionRecipes,
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

	function setUnits(value) {
		units = validateSettings({ units: value }).units;
		replaceUnitURL(units);
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
			servings, units,
		});
		servings = parsed.servings;
		units = parsed.units;
		familyChoice = { ...familyChoice, ...parsed.familyChoice };
		recipeId = parsed.recipeId;
	}

	// Saved settings are preferences only; a missing, unreadable or stale
	// entry restores the defaults, key by key.
	function restoreSettings() {
		let saved = null;
		try {
			saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		} catch (error) {
			// Do not log saved data, which may appear in a JSON parse error.
			console.error("Recipe settings could not be restored; using defaults.", error instanceof Error ? error.name : "Unknown error");
		}
		({ servings, units, filters, appliancesOnHand, familyChoice } = parseSavedSettings(
			saved,
			{ recipes, ingredients: smoothieIngredients },
		));
	}

	const printSession = createRecipePrintSession(
		() => effectivePrintMode,
		() => {
			// Browser-menu printing snapshots the DOM as beforeprint returns.
			flushSync(() => { printPrepared = true; });
		},
		() => {
			printPrepared = false;
			printMode = "auto";
			printRecipeId = "";
		},
	);

	async function print(target, id = "") {
		printRecipeId = id;
		printMode = target;
		await tick();
		message = await printSession.print(tick);
	}

	onMount(() => {
		restoreSettings();
		readURL();
		setCollection(collection);
		const visit = listVisit(history.state, recipes);
		if (visit) { query = visit.query; shuffledOrder = visit.order; page = { key: browseKey, limit: visit.limit }; }
		hydrated = true;
		if (visit && !recipeId) void tick().then(() => window.scrollTo({ top: visit.scrollY, behavior: "instant" }));
		if (recipeId) void openRecipe(recipeId);
		const stopPrint = printSession.listen();
		const hash = () => {
			const id = window.location.hash.slice(1);
			if (recipes.some((recipe) => recipe.id === id)) void openRecipe(id);
			else if (recipeId) void backToResults(false);
		};
		const saveVisit = () => history.replaceState({ ...history.state, recipeList: { scrollY: window.scrollY, query, limit: cardLimit, order: shuffledOrder ? [...shuffledOrder] : null } }, "");
		window.addEventListener("pagehide", saveVisit);
		window.addEventListener("hashchange", hash);
		return () => {
			window.removeEventListener("pagehide", saveVisit);
			window.removeEventListener("hashchange", hash);
			shuffleAnimation?.cancel();
			stopPrint();
		};
	});

	// Saves the shape parseSavedSettings reads.
	$effect(() => {
		if (!hydrated) return;
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ servings, units, filters, appliancesOnHand, familyChoice }),
			);
		} catch (error) {
			console.error("Recipe settings could not be saved; changes apply only to this visit.", error instanceof Error ? error.name : "Unknown error");
		}
	});
</script>

<section class="meal-library" data-hydrated={hydrated} data-print-prepared={printPrepared} bind:this={libraryElement} aria-label="Easy Meals & Smoothies recipe library">
	<LibraryControls
		{collection}
		bind:query
		{pathname}
		{hydrated}
		{servings}
		{units}
		onUnitsChange={setUnits}
		onServingsChange={setServings}
		{collectionRecipes}
		{collectionHasIron}
		{smoothieIngredients}
		{hasMatches}
		onPrintAll={() => print("all")}
		bind:filters
		bind:appliancesOnHand
	/>

	<div class="browse" id="meal-results" data-match-count={visibleRecipes.length} aria-busy={shuffling}>
		<div class="results-heading"><h2 bind:this={listHeading} tabindex="-1">{collection === "smoothie" ? "Find your smoothie" : "Find your meal"}</h2><Button variant="outline" type="button" disabled={!hydrated || shuffling || visibleRecipes.length < 2} onclick={shuffleCards}><Shuffle aria-hidden="true" />Shuffle recipes</Button></div>
		<p class="no-results" role="status">{hydrated ? !visibleRecipes.length ? NO_RESULTS : query.trim() ? `${visibleRecipes.length} ${visibleRecipes.length === 1 ? "recipe" : "recipes"} found` : "" : ""}</p>
		<div class="card-stage">
		{#if shuffling}<div class="recipe-grid shuffle-skeleton" bind:this={skeleton} aria-hidden="true">{#each [0, 1, 2] as placeholder (placeholder)}<div class="skeleton-card"><div class="skeleton-photo"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-button"></div></div>{/each}</div><span class="visually-hidden" role="status">Shuffling recipes</span>{/if}
		<div class="recipe-grid" class:shuffling inert={shuffling}>
			{#each renderedRecipes as recipe (recipe.id)}
				<RecipeCard {recipe} servings={recipeSettings.servings} settings={recipeSettings} onPrint={() => print("recipe", recipe.id)} disabled={!hydrated} href={recipeHref(recipe, recipeSettings)} />
			{/each}
		</div>
		</div>
		{#if hydrated && renderedRecipes.length < visibleRecipes.length}<div class="load-more" {@attach watchMore}><Button variant="outline" type="button" onclick={loadMoreCards}>Load more recipes</Button><p>{renderedRecipes.length} of {visibleRecipes.length} recipes shown</p></div>{/if}
	</div>

	{#if current}
		<RecipeTakeover recipe={current} settings={recipeSettings} onUnitsChange={setUnits} onBack={() => backToResults()} onPrint={() => print("recipe")} onSideChange={(value) => setChoice(current.id, value)} bind:heading={detailHeading} bind:dialog={recipeDialog} />
	{/if}

	<RecipeDownload recipes={collectionRecipes} settings={recipeSettings} disabled={!hydrated} />
	<p class="action-status" role="status" aria-live="polite">{message}</p>
	<div class="print-output">{#if printPrepared}<RecipePrint recipes={printRecipes} settings={recipeSettings} />{/if}</div>
</section>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.results-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 0.8rem; }
		.results-heading :global(h2) { margin: 0; }
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

		.card-stage { position: relative; }
		.shuffling { visibility: hidden; opacity: 0; pointer-events: none; }
		.shuffle-skeleton { position: absolute; inset: 0; overflow: hidden; }
		.skeleton-card { border: 1px solid var(--recipe-line); border-radius: 16px; padding: 20px; background: var(--recipe-paper); align-self: start; }
		.skeleton-photo, .skeleton-line, .skeleton-button { background: var(--recipe-soft); border-radius: 8px; }
		.skeleton-photo { aspect-ratio: 4 / 3; margin-bottom: 24px; }
		.skeleton-line { height: 24px; margin-bottom: 12px; }
		.skeleton-line.short { width: 65%; }
		.skeleton-button { height: 48px; margin-top: 48px; }
		.load-more { text-align: center; padding: 24px 0; }
		.load-more p { color: var(--recipe-muted); font-size: .85rem; }
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
