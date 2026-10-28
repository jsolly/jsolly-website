<script>
	import Share2 from "@lucide/svelte/icons/share-2";
	import { onMount, tick } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import { BASE_SERVINGS, SERVING_CHOICES } from "./constants.mjs";
	import RecipeContent from "./RecipeContent.svelte";
	import RecipeOfflineStatus from "./RecipeOfflineStatus.svelte";
	import RecipePrintButton from "./RecipePrintButton.svelte";
	import { validateSettings } from "./recipe-logic.mjs";
	import { madeDateFor, madeDateLabel, readMadeRecipes, todayMadeDate, watchMadeRecipes, writeMadeRecipe } from "./recipe-made.mjs";
	import { collectionReturn, takeLegacyRedirect } from "./recipe-navigation.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL, recipePageURL } from "./recipe-url.mjs";
	import ShareRecipe from "./ShareRecipe.svelte";
	import { readRecipePreferences, writeRecipePreferences } from "./unit-preference.mjs";

	// Keep preference-dependent content hidden until URL and saved settings
	// are resolved. The no-JavaScript stylesheet reveals the static fallback.
	let { recipe } = $props();
	const servingsId = $props.id();
	const madeId = `${servingsId}-made`;
	let interactive = $state(false);
	let message = $state("");
	let returnUrl = $state("");
	// The local date this reader last made the recipe, or "" (recipe-made.mjs),
	// and today's, read in the browser so "Made it today" can tell them apart.
	let madeOn = $state("");
	let today = $state("");
	// A mark the browser refused to save stays for this visit, not overwritten by a re-read.
	let madeUnsaved = false;
	let madeBox = $state(null);
	const MADE_SAVE_FAILED = "Your made mark applies to this visit but could not be saved.";
	let madeStatus = $state("");
	let settings = $state({
		servings: BASE_SERVINGS,
		units: "us",
		familyDiners: 0,
		familyChoice: {},
	});
	const collection = $derived(
		recipe.type === "smoothie" ? "smoothies" : "meals",
	);
	const printSession = createRecipePrintSession(() => "recipe");

	async function print() {
		message = await printSession.print();
	}

	// An explicit choice replaces the link's old overrides before a reload.
	function replacePageURL() {
		history.replaceState(history.state, "", recipePageURL(new URL(location.href), recipe, settings));
	}

	function persistPreferences() {
		if (!writeRecipePreferences(recipe, settings)) message = "Preferences apply to this visit but could not be saved.";
	}

	function setServings(value) {
		settings = { ...settings, ...validateSettings({ ...settings, servings: Number(value) }) };
		replacePageURL();
		persistPreferences();
	}

	function setSide(value) {
		settings = {
			...settings,
			familyDiners: value && !settings.familyDiners ? 1 : settings.familyDiners,
			familyChoice: { ...settings.familyChoice, [recipe.id]: value },
		};
		replacePageURL();
		persistPreferences();
	}

	function setSideDiners(value) {
		settings = { ...settings, familyDiners: validateSettings({ ...settings, familyDiners: value }).familyDiners };
		replacePageURL();
		persistPreferences();
	}

	function setMade(made, confirm = false) {
		today = todayMadeDate();
		madeOn = made ? today : "";
		madeUnsaved = !writeMadeRecipe(recipe.id, madeOn);
		if (madeUnsaved) madeStatus = MADE_SAVE_FAILED;
		else madeStatus = confirm ? `Marked made today, ${madeDateLabel(today)}.` : "";
	}

	// "Made it today" removes itself once the date is today, so focus moves to
	// the checkbox that stays and the status line confirms the dated mark.
	async function setMadeToday() {
		setMade(true, true);
		await tick();
		madeBox?.focus();
	}

	function refreshMade() {
		today = todayMadeDate();
		if (madeUnsaved) return;
		madeOn = madeDateFor(readMadeRecipes(), recipe.id);
		// A confirmation no longer describes a mark another tab cleared or moved.
		if (madeOn !== today) madeStatus = "";
	}


	onMount(() => {
		// A legacy /recipes/#<id> redirect replaced the collection entry, so Back
		// follows its collection link rather than history, which would leave the site.
		const legacy = history.state?.recipeLegacyRedirect === true || takeLegacyRedirect(recipe.id);
		if (legacy) history.replaceState({ ...history.state, recipeLegacyRedirect: true }, "");
		else {
			returnUrl = collectionReturn(history.state, document.referrer, new URL(location.href), collection);
			if (returnUrl) history.replaceState({ ...history.state, recipeReturn: returnUrl }, "");
		}
		const url = new URL(window.location.href);
		const saved = readRecipePreferences(recipe);
		const parsed = readRecipeURL(url, [recipe], {
			servings: saved.servings,
			units: saved.units,
			familyDiners: saved.familyDiners,
			familyChoice: saved.side ? { [recipe.id]: saved.side } : {},
		});
		settings = {
			...settings,
			servings: parsed.servings,
			units: parsed.units,
			familyDiners: parsed.familyDiners,
			familyChoice: parsed.familyChoice,
		};
		refreshMade();
		interactive = true;
		const stopWatchingMade = watchMadeRecipes(refreshMade);
		const stopPrint = printSession.listen();
		return () => { stopPrint(); stopWatchingMade(); };
	});
</script>

<div class="recipe-page" data-preferences-ready={interactive} aria-busy={!interactive}>
	<section class="recipe-detail print-document" id={recipe.id}>
		<div class="toolbar">
			<a href={returnUrl || `/recipes/${collection}/`} onclick={(event) => { if (returnUrl && history.length > 1 && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); history.back(); } }}>← Back to {returnUrl.startsWith("/recipes/saved/") ? "saved recipes" : returnUrl.startsWith("/recipes/?") || returnUrl === "/recipes/" ? "recipes" : collection}</a>
			<RecipePrintButton {recipe} {settings} class="recipe-enhanced" disabled={!interactive} onPrint={print} />
			<RecipeOfflineStatus {recipe} />
		</div>
		<RecipeContent {recipe} {settings} {interactive} onSideChange={setSide} onSideDinersChange={setSideDiners}>
			{#snippet controls()}
			<label class="servings recipe-enhanced" for={servingsId}
				>Servings<NativeSelect id={servingsId} value={settings.servings} disabled={!interactive} onchange={(event) => setServings(event.currentTarget.value)}>
					{#each SERVING_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
				</NativeSelect></label
			>
			{/snippet}
		</RecipeContent>
		<div class="made recipe-enhanced">
			<div class="made-controls">
				<label for={madeId}><Checkbox bind:ref={madeBox} id={madeId} checked={madeOn !== ""} disabled={!interactive} onCheckedChange={(checked) => setMade(checked === true)} />I made this</label>
				{#if madeOn}<span class="made-date">Last made {madeDateLabel(madeOn)}</span>{/if}
				{#if madeOn && madeOn < today}<Button class="made-again" variant="outline" type="button" disabled={!interactive} onclick={setMadeToday}>Made it today</Button>{/if}
			</div>
			<p class="made-status" role="status">{madeStatus}</p>
		</div>
		<div class="recipe-enhanced"><ShareRecipe {recipe} {settings} disabled={!interactive} /></div>
		<noscript><div class="share"><Button variant="outline" href={`/recipes/${recipe.id}/`}><Share2 aria-hidden="true" size={18} />Share recipe link</Button></div></noscript>
		<p role="status">{message}</p>
	</section>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.recipe-detail {
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			border: 1px solid var(--recipe-line);
			border-radius: 20px;
			padding: 28px;
			font: 16px/1.4 var(--font-body);
		}
		.servings {
			display: flex;
			gap: 10px;
			align-items: center;
		}
		.servings :global(select) {
			min-width: 72px;
			min-height: 44px;
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			padding: 8px;
			/* Muted ink keeps the control's boundary at 3:1 or more. */
			border: 1px solid var(--recipe-muted);
			border-radius: 8px;
		}
		.toolbar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			margin-bottom: 16px;
		}
		a {
			color: var(--recipe-accent);
		}
		.made {
			margin-top: 24px;
			border-top: 1px solid var(--recipe-line);
			padding-top: 16px;
		}
		.made-controls {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px 16px;
		}
		.made-status:not(:empty) {
			margin-top: 8px;
		}
		.made label {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 44px;
			font-weight: 650;
			cursor: pointer;
		}
		.made-date {
			color: var(--recipe-muted);
		}
		.made :global(.made-again) {
			min-height: 44px;
		}
		.share {
			margin-top: 24px;
			border-top: 1px solid var(--recipe-line);
			padding-top: 16px;
		}
		@media (max-width: 600px) {
			.toolbar {
				flex-direction: column;
				align-items: stretch;
			}
			.recipe-detail {
				padding: 18px;
			}
		}
		@media print {
			.toolbar,
			.made,
			.share,
			.servings {
				display: none;
			}
			.recipe-detail {
				padding: 0;
				border: 0;
				background: white;
				color: black;
			}
		}
	}
</style>
