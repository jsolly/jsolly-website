<script>
	import Shuffle from "@lucide/svelte/icons/shuffle";
	import X from "@lucide/svelte/icons/x";
	import { flushSync, onMount, tick, untrack } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import { activeFilters, withoutFilter, withoutFilters } from "./active-filters.mjs";
	import { BASE_SERVINGS, DEFAULT_FILTERS, defaultAppliances, RECIPE_BATCH_SIZE, STORAGE_KEY } from "./constants.mjs";
	import LibraryControls from "./LibraryControls.svelte";
	import NativeRecipeControls from "./NativeRecipeControls.svelte";
	import { parseSavedSettings } from "./nutrient-filters.mjs";
	import RecipeCard from "./RecipeCard.svelte";
	import { withRecipeBrowse } from "./recipe-browse-coordination.mjs";
	import { validateSettings } from "./recipe-logic.mjs";
	import { madeDateFor, readMadeRecipes, watchMadeRecipes } from "./recipe-made.mjs";
	import { clearLegacyRedirect, markLegacyRedirect } from "./recipe-navigation.mjs";
	import { orderRecipeIds } from "./recipe-order.mjs";
	import { loadRecipePack } from "./recipe-pack.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { retiredRecipePath } from "./recipe-publication.mjs";
	import { readRecipeURL, recipeBrowseHref, recipeHref } from "./recipe-url.mjs";
	import { replaceUnitURL } from "./unit-preference.mjs";

	let { initialCollection = "meal", pathname, initial, recipeIndex, saved = false } = $props();
	let savedMode = $state(untrack(() => saved));
	let collection = $state(untrack(() => initialCollection));
	let result = $state.raw(untrack(() => initial));
	let summaries = $state.raw(untrack(() => initial.cards));
	let visibleLimit = $state(RECIPE_BATCH_SIZE);
	let hydrated = $state(false);
	let query = $state("");
	let servings = $state(BASE_SERVINGS);
	let units = $state("us");
	let filters = $state({ ...DEFAULT_FILTERS });
	let appliancesOnHand = $state({ ...defaultAppliances });
	let familyChoice = $state({});
	let familyDiners = $state(0);
	// Recipe id → the local date the reader last made it (recipe-made.mjs).
	let made = $state.raw({});
	let seed = $state("");
	let expanding;
	let loading = $state(false);
	let failure = $state("");
	let releaseMismatch = $state(false);
	let RecipePrint = $state.raw(null);
	let printRecipe = $state.raw(null);
	let printPrepared = $state(false);
	let libraryElement = $state(null);
	let listHeading = $state(null);
	let message = $state("");
	let shuffling = $state(false);
	let pendingSavedVisit;
	let openedId = "";
	let savedRecords = [];
	let unsupportedSavedRecords = $state.raw([]);
	let savedGeneration = 0;
	let generation = 0;
	let requestedKey = "";
	let controller;
	let pending;
	let backgroundTimer;
	let stopped = false;
	let failedRequest = null;
	let allowFilterReset = true;
	const SLOW_CONNECTION = /^(?:slow-2g|2g|3g)$/u;
	const RECIPE_PATH = /^\/recipes\/(?<id>[^/]+)\/$/u;
	const recipeSettings = $derived({ servings, units, familyDiners, familyChoice });
	const state = $derived({ settings: { ...recipeSettings, filters, appliancesOnHand }, query, seed });
	const browseKey = $derived(JSON.stringify([collection, query, servings, filters, appliancesOnHand, savedMode]));
	const renderedRecipes = $derived(summaries.slice(0, visibleLimit));
	const smoothieIngredients = $derived(result.filterChoices.smoothieIngredients);
	const hasMore = $derived(visibleLimit < result.total);
	// The filters and search narrowing these results, shown as removable chips.
	const chips = $derived(activeFilters(filters, query, { collection, hasIron: result.filterChoices.collectionHasIron, ingredientLabels: smoothieIngredients }));

	function params(page = 1, shuffle = false) {
		const values = new URLSearchParams({ path: collection === "smoothie" ? "/recipes/smoothies/" : "/recipes/meals/", browse: "1", page: String(page), servings: String(servings), units, q: query, seed, release: initial.release });
		for (const [key, value] of Object.entries(filters)) {
			if (Array.isArray(value)) for (const item of value) values.append(key, item);
			else if (value) values.set(key, "1");
		}
		for (const [key, value] of Object.entries(appliancesOnHand)) values.set(`appliance.${key}`, String(value));
		if (shuffle) values.set("shuffle", "1");
		return values;
	}
	function canBackground() {
		const connection = navigator.connection;
		return !stopped && !document.hidden && navigator.onLine && !connection?.saveData && !SLOW_CONNECTION.test(connection?.effectiveType || "");
	}
	function scheduleBackground() {
		clearTimeout(backgroundTimer);
		if (!canBackground() || failure || !result.nextPage || savedMode) return;
		backgroundTimer = setTimeout(() => { if (canBackground()) void requestPage(result.nextPage, false); }, 400);
	}
	function requestPage(page, replace, shuffle = false) {
		if (pending) return pending;
		const own = generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading = true;
		pending = (async () => {
			try {
				const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
				const next = await withRecipeBrowse(requestSignal, async () => {
					const response = await fetch(`/api/recipe-browse/?${params(page, shuffle)}`, { headers: { Accept: "application/json" }, signal: requestSignal, priority: replace ? "high" : "low" });
					if (response.status === 409) { await response.text(); if (own === generation) releaseMismatch = true; throw new Error("A newer recipe library is available. Update and reload to continue."); }
					if (!response.ok) { await response.text(); throw new Error("Recipes could not be loaded. Your current results are still here."); }
					return response.json();
				});
				if (own !== generation || stopped) return;
				if (next.release !== initial.release) { releaseMismatch = true; throw new Error("A newer recipe library is available. Update and reload to continue."); }
				if (replace && allowFilterReset) {
					allowFilterReset = false;
					if (next.filterChoices.matchesDefaultInventory === false) { filters = { ...DEFAULT_FILTERS }; return; }
				}
				const old = replace ? [] : summaries;
				summaries = [...new Map([...old, ...next.cards].map((card) => [card.id, card])).values()];
				result = next;
				seed = next.seed;
				failure = ""; failedRequest = null;
				if (replace) visibleLimit = RECIPE_BATCH_SIZE;
			} catch (error) {
				if (own === generation && !signal.aborted) { failure = error.message; failedRequest = { page, replace, shuffle }; }
			} finally {
				if (own === generation) { loading = false; pending = null; controller = null; scheduleBackground(); }
			}
		})();
		return pending;
	}
	async function refreshSaved() {
		const own = ++savedGeneration;
		try {
			const { listSavedRecipes } = await import("./recipe-offline.mjs");
			const records = await listSavedRecipes();
			if (own !== savedGeneration || stopped) return;
			unsupportedSavedRecords = records.filter((record) => record.schemaVersion !== 1);
			savedRecords = records.filter((record) => record.schemaVersion === 1);
			if (!savedRecords.length) { summaries = []; result = { ...initial, cards: [], total: 0, nextPage: null }; failure = ""; return; }
			const { createBrowsePage } = await import("./recipe-summary.mjs");
			if (own !== savedGeneration || stopped) return;
			const recipes = savedRecords.map((record) => record.recipe);
			const next = createBrowsePage(recipes, collection, { ...state, page: 1 }, initial.release);
			const cards = [];
			for (let page = 1; page <= Math.max(1, Math.ceil(next.total / RECIPE_BATCH_SIZE)); page++) cards.push(...createBrowsePage(recipes, collection, { ...state, page }, initial.release).cards);
			result = { ...next, nextPage: null };
			summaries = cards; visibleLimit = RECIPE_BATCH_SIZE; failure = "";
			if (pendingSavedVisit) {
				const visit = pendingSavedVisit; pendingSavedVisit = null;
				visibleLimit = Math.min(cards.length, Math.max(RECIPE_BATCH_SIZE, visit.limit || RECIPE_BATCH_SIZE));
				await tick(); restoreVisitPosition(visit);
			}
		} catch { if (own === savedGeneration) failure = "Saved recipes could not be read. Retry when storage is available."; }
	}
	function begin(key) {
		requestedKey = key;
		generation++;
		controller?.abort(); pending = null; loading = false;
		clearTimeout(backgroundTimer); failure = "";
		if (savedMode) void refreshSaved();
		else void requestPage(1, true);
	}
	function loadMore(focus = false) {
		if (failure) return;
		if (expanding?.generation === generation) { expanding.focus ||= focus; return expanding.promise; }
		const own = generation;
		const first = renderedRecipes.length;
		const expansion = { generation: own, focus };
		expansion.promise = (async () => {
			if (summaries.length <= visibleLimit && result.nextPage) await requestPage(result.nextPage, false);
			if (own !== generation || failure || stopped) return;
			visibleLimit = Math.min(summaries.length, result.total, visibleLimit + RECIPE_BATCH_SIZE);
			await tick();
			if (expansion.focus) libraryElement?.querySelectorAll(".recipe-card .title-button")[first]?.focus();
		})().finally(() => { if (expanding === expansion) expanding = null; });
		expanding = expansion;
		return expansion.promise;
	}
	async function retryBrowse() {
		failure = "";
		if (savedMode) { await refreshSaved(); return; }
		const retry = failedRequest || { page: 1, replace: true, shuffle: false };
		if (retry.replace) await requestPage(retry.page, true, retry.shuffle);
		else await loadMore(true);
	}
	function watchMore(node) {
		if (!("IntersectionObserver" in window)) return;
		const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); }, { rootMargin: "300px" });
		observer.observe(node);
		return () => observer.disconnect();
	}
	async function shuffleCards() {
		if (shuffling || result.total < 2) return;
		shuffling = true;
		const local = !loading && browseKey === requestedKey && summaries.length === result.total;
		requestedKey = browseKey;
		if (local) {
			seed = crypto.randomUUID();
			const universe = savedMode ? savedRecords.map((record) => record.recipe) : recipeIndex;
			const ranks = new Map(orderRecipeIds(universe.map((recipe) => recipe.id), seed).map((id, index) => [id, index]));
			summaries = [...summaries].sort((a, b) => ranks.get(a.id) - ranks.get(b.id));
			result = { ...result, seed };
			visibleLimit = RECIPE_BATCH_SIZE;
		} else {
			generation++; controller?.abort(); pending = null; failure = "";
			await requestPage(1, true, true);
		}
		shuffling = false;
		if (!failure) { await tick(); listHeading?.focus({ preventScroll: true }); listHeading?.scrollIntoView({ block: "start" }); }
	}
	function hasMatches(overrides) {
		const choices = result.filterChoices;
		const groups = { protein: "proteinChoice", starch: "starchChoice", ingredients: "ingredientChoice" };
		for (const [name, key] of Object.entries(groups)) if (overrides[name]) {
			const before = filters[key]; const after = overrides[name];
			const changed = [...new Set([...before, ...after])].find((item) => before.includes(item) !== after.includes(item));
			return !changed || choices[key]?.[changed] !== false;
		}
		const flags = { vegetarian: "vegetarianOnly", dumpAndGo: "dumpAndGo", immune: "immuneSupport", iron: "ironRich", omega: "omega3" };
		return Object.entries(flags).every(([name, key]) => !overrides[name] || choices.flags[key] !== false);
	}
	async function updateLibrary() {
		try {
			const registration = await navigator.serviceWorker?.getRegistration("/recipes/");
			if (registration) {
				await registration.update();
				const button = document.querySelector("#recipe-update-button");
				if (registration.waiting && button) button.click();
				else message = "Checking for an update. Use Update and reload when the update notice appears.";
			} else window.location.reload();
		} catch {
			message = "The update could not be checked. Reconnect and choose Check for update to retry.";
		}
	}
	// Removing a chip moves focus to the chip now in its place, or to the
	// results heading when none remain, so keyboard focus is never lost.
	async function removeChip(chip, index) {
		if (chip.key === "query") query = "";
		else filters = withoutFilter(filters, chip);
		await tick();
		const remaining = libraryElement?.querySelectorAll(".active-filters li button") ?? [];
		(remaining[Math.min(index, remaining.length - 1)] ?? listHeading)?.focus();
	}
	async function clearChips() {
		filters = withoutFilters(filters, chips);
		query = "";
		await tick();
		listHeading?.focus();
	}
	function setUnits(value) { units = validateSettings({ units: value }).units; replaceUnitURL(units); }
	function setServings(value) { ({ servings, familyDiners } = validateSettings({ servings: Number(value), familyDiners })); }
	async function saveOpened(recipe) {
		if (!("serviceWorker" in navigator) || !document.querySelector("#recipe-offline-status")) return;
		try {
			if (!await navigator.serviceWorker.getRegistration("/recipes/")) return; const { saveRecipeOffline } = await import("./recipe-offline.mjs"); await saveRecipeOffline(recipe.id, initial.release); }
		catch { message = "This recipe was prepared for printing, but could not be saved offline. Retry by printing or opening it again."; }
	}
	function getDetail(id) {
		if (savedMode) {
			const record = savedRecords.find((item) => item.id === id);
			if (!record) throw new Error("This recipe has not been saved offline.");
			return record.recipe;
		}
		return loadRecipePack(id, initial.release);
	}
	const printSession = createRecipePrintSession(() => "recipe", () => {
		if (printRecipe) flushSync(() => { printPrepared = true; });
	}, () => { printPrepared = false; printRecipe = null; });
	async function print(id) {
		const record = savedRecords.find((item) => item.id === id);
		if (savedMode && record && record.release !== initial.release) { window.location.assign(recipeBrowseHref(record.recipe, recipeSettings)); return; }
		message = "Loading recipe for printing…";
		try {
			const [recipe, module] = await Promise.all([getDetail(id), import("./RecipePrint.svelte")]);
			RecipePrint = module.default; printRecipe = recipe;
			if (!savedMode) void saveOpened(recipe);
			await tick(); message = await printSession.print(tick);
		} catch (error) { message = error.message; }
	}
	// Card links navigate normally; recording the visit at click time, as well as
	// on pagehide, lets Back restore the order, search and scroll position.
	function rememberVisit(event) {
		const anchor = event.target.closest?.("a[href]");
		if (!anchor) return;
		const url = new URL(anchor.href, location.href);
		const match = RECIPE_PATH.exec(url.pathname);
		if (url.origin !== location.origin || !match) return;
		openedId = match.groups.id; saveVisit();
	}
	// Back returns to the saved scroll position with focus on the recipe left from.
	function restoreVisitPosition(visit) {
		window.scrollTo({ top: visit.scrollY || 0, behavior: "instant" });
		if (typeof visit.openedId !== "string" || !visit.openedId) return;
		const link = [...(libraryElement?.querySelectorAll(".recipe-card a.title-button") ?? [])].find((element) => element.dataset.recipeId === visit.openedId);
		(link ?? listHeading)?.focus({ preventScroll: true });
	}
	function saveVisit() {
		const visit = JSON.parse(JSON.stringify({ query, summaries, result, seed, limit: visibleLimit, scrollY: window.scrollY, collection, savedMode, openedId }));
		history.replaceState({ ...history.state, recipeList: visit }, "");
	}
	onMount(() => {
		let stored;
		try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
		catch (error) { console.error("Recipe settings could not be restored; using defaults.", error instanceof Error ? error.name : "Unknown error"); message = "Saved preferences could not be read; using defaults."; }
		({ servings, units, familyDiners, filters, appliancesOnHand, familyChoice } = parseSavedSettings(stored, { recipes: recipeIndex, ingredients: smoothieIngredients }));
		savedMode = saved || !navigator.onLine;
		if (savedMode) { summaries = []; result = { ...initial, cards: [], total: 0, nextPage: null }; }
		const url = new URL(window.location.href);
		const parsed = readRecipeURL(url, recipeIndex, { servings, units, familyDiners, familyChoice });
		servings = parsed.servings; units = parsed.units; familyDiners = parsed.familyDiners; familyChoice = parsed.familyChoice;
		// Old blogthedata.com posts link to /recipes/#<recipe-id>, which the
		// redirect host carries here. This redirect exists only to accommodate
		// those legacy links: recipes render on their own pages, so the entry is
		// replaced before any browsing request, listener or settings write starts.
		const retiredPath = retiredRecipePath(url.hash.slice(1));
		if (retiredPath) { location.replace(retiredPath); return; }
		const legacyRecipe = recipeIndex.find((recipe) => recipe.id === parsed.recipeId);
		if (legacyRecipe) {
			markLegacyRedirect(legacyRecipe.id);
			const settings = { servings, units, familyDiners, familyChoice };
			const explicit = ["servings", "units", "starch", "sideDiners"].some((key) => url.searchParams.has(key));
			location.replace(explicit ? recipeHref(legacyRecipe, settings) : recipeBrowseHref(legacyRecipe, settings));
			return;
		}
		clearLegacyRedirect();
		const refreshMade = () => { made = readMadeRecipes(); };
		refreshMade();
		const stopWatchingMade = watchMadeRecipes(refreshMade);
		if (savedMode && url.searchParams.get("collection") === "smoothie") collection = "smoothie";
		const visit = history.state?.recipeList;
		if (visit?.savedMode === savedMode && visit?.result?.release === initial.release && Array.isArray(visit.summaries) && ["meal", "smoothie"].includes(visit.collection)) {
			collection = visit.collection; query = visit.query || ""; seed = visit.seed || "";
			if (savedMode) pendingSavedVisit = visit;
			else {
				result = visit.result; summaries = visit.summaries;
				visibleLimit = Math.max(RECIPE_BATCH_SIZE, visit.limit || RECIPE_BATCH_SIZE);
				requestedKey = browseKey;
				void tick().then(() => restoreVisitPosition(visit));
			}
		} else if (!savedMode && JSON.stringify([collection, query, servings, filters, appliancesOnHand, savedMode]) === JSON.stringify([initialCollection, "", BASE_SERVINGS, DEFAULT_FILTERS, defaultAppliances, false])) requestedKey = browseKey;
		hydrated = true;
		const stopPrint = printSession.listen();
		libraryElement.addEventListener("click", rememberVisit);
		const resume = () => { const nextSaved = saved || !navigator.onLine; if (nextSaved && !savedMode) { summaries = []; result = { ...result, cards: [], total: 0, nextPage: null }; } savedMode = nextSaved; scheduleBackground(); };
		window.addEventListener("pagehide", saveVisit);
		document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", resume);
		navigator.connection?.addEventListener("change", resume);
		scheduleBackground();
		return () => { stopped = true; generation++; savedGeneration++; controller?.abort(); clearTimeout(backgroundTimer); stopPrint(); libraryElement?.removeEventListener("click", rememberVisit); window.removeEventListener("pagehide", saveVisit); stopWatchingMade(); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", resume); navigator.connection?.removeEventListener("change", resume); };
	});
	$effect(() => {
		const key = browseKey;
		if (!hydrated) return;
		untrack(() => { if (key !== requestedKey) begin(key); });
	});
	$effect(() => {
		if (!hydrated) return;
		const settings = JSON.stringify({ servings, units, familyDiners, filters, appliancesOnHand, familyChoice });
		try { localStorage.setItem(STORAGE_KEY, settings); } catch (error) { console.error("Recipe settings could not be saved; changes apply only to this visit.", error instanceof Error ? error.name : "Unknown error"); message = "Preferences apply to this visit but could not be saved."; }
	});
</script>

<section class="meal-library" data-hydrated={hydrated} data-preferences-ready={hydrated} aria-busy={!hydrated} data-print-prepared={printPrepared} bind:this={libraryElement} aria-label={savedMode ? "Saved recipes" : "Keto meals & smoothies recipe library"}>
	{#if saved}<p>Saved recipes are available offline. Search, filters and shuffle use this saved collection.</p>{:else}<p><a href="/recipes/saved/">Saved recipes</a></p>{/if}
	<LibraryControls {collection} saved={savedMode} onCollectionChange={(value) => { collection = value; }} bind:query {pathname} {hydrated} {servings} {units} onUnitsChange={setUnits} onServingsChange={setServings} shownApplianceKeys={result.filterChoices.shownAppliances} collectionHasIron={result.filterChoices.collectionHasIron} {smoothieIngredients} {hasMatches} bind:filters bind:appliancesOnHand />
	{#if !saved}<noscript><NativeRecipeControls {collection} {pathname} metadata={result.filterChoices} /></noscript>{/if}
	<div class="browse" id="meal-results" data-match-count={result.total} aria-busy={shuffling || loading}>
		<div class="results-heading"><h2 bind:this={listHeading} tabindex="-1">{savedMode ? "Saved recipes" : collection === "smoothie" ? "Find your smoothie" : "Find your meal"}</h2><Button class="enhanced-shuffle" variant="outline" type="button" disabled={!hydrated || shuffling || result.total < 2} onclick={shuffleCards}><Shuffle aria-hidden="true" />{collection === "smoothie" ? "Shuffle smoothies" : "Shuffle meals"}</Button>{#if !saved}<noscript><Button variant="outline" type="submit" form="recipe-browse-form" name="shuffle" value="1"><Shuffle aria-hidden="true" />{collection === "smoothie" ? "Shuffle smoothies" : "Shuffle meals"}</Button></noscript>{/if}</div>
		{#if hydrated && chips.length}<div class="active-filters"><ul aria-label="Active filters and search">{#each chips as chip, index (`${chip.key}:${chip.value ?? ""}`)}<li><Button variant="outline" size="sm" type="button" aria-label={`Remove ${chip.key === "query" ? "search" : "filter"}: ${chip.label}`} onclick={() => removeChip(chip, index)}>{chip.label}<X aria-hidden="true" /></Button></li>{/each}</ul><Button variant="ghost" size="sm" type="button" onclick={clearChips}>Clear all</Button></div>{/if}
		<p class="no-results" role="status">{!result.total ? savedMode ? "No saved recipes match. Open a recipe online to save it for offline use." : "No recipes match your search and filters. Try fewer words or adjust the filters." : query.trim() ? `${result.total} recipes found` : ""}</p>
		<div class="recipe-grid">
			{#each renderedRecipes as recipe (recipe.id)}<RecipeCard {recipe} madeOn={madeDateFor(made, recipe.id)} servings={recipeSettings.servings} settings={recipeSettings} onPrint={() => print(recipe.id)} disabled={!hydrated} href={recipeBrowseHref(recipe, recipeSettings)} />{/each}
		</div>
		{#if unsupportedSavedRecords.length}<ul>{#each unsupportedSavedRecords as record (record.id)}<li><a href={`/recipes/${record.id}/`}>{record.recipe?.title || record.id}</a> - saved with another version; open its saved page to cook.</li>{/each}</ul>{/if}
		{#if hydrated && hasMore}<div class="load-more" {@attach watchMore}><Button variant="outline" type="button" aria-busy={loading} onclick={() => loadMore(true)}>Load more recipes</Button><p>{renderedRecipes.length} of {result.total} recipes shown</p></div>{/if}
		{#if !savedMode && initial.nextPage}<noscript><nav class="recipe-pagination" aria-label="Recipe pages"><a href={`${pathname}?browse=1&page=2`}>Next recipes</a></nav></noscript>{/if}
		{#if failure}<p role="alert">{failure}</p>{#if releaseMismatch}<Button variant="outline" onclick={updateLibrary}>Check for update</Button>{:else}<Button variant="outline" onclick={retryBrowse}>Retry</Button>{/if}{/if}
	</div>
	<p class="action-status" role="status" aria-live="polite">{message}</p>
	<div class="print-output">{#if printPrepared && RecipePrint}<RecipePrint recipe={printRecipe} settings={recipeSettings} />{/if}</div>
</section>
<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.results-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 0.8rem; }
		.results-heading :global(h2) { margin: 0; }
		.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 0.8rem; }
		/* .meal-library outranks the library's general list indent. */
		.meal-library .active-filters ul { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
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
		/* Chips are compact; this follows and outranks the library's button sizing. */
		.meal-library .active-filters :global(button) { min-height: 36px; gap: 6px; font-size: 0.86rem; }
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
			.meal-library[data-print-prepared="true"] > :global(:not(.print-output)) { display: none; }
			.meal-library:not([data-print-prepared="true"]) > :global(.library-controls),
			.meal-library:not([data-print-prepared="true"]) .results-heading,
			.meal-library:not([data-print-prepared="true"]) .load-more { display: none; }
			.meal-library[data-print-prepared="true"] > .print-output { display: block; }
		}
	}
</style>
