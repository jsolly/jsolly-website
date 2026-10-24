<script>
	import Share2 from "@lucide/svelte/icons/share-2";
	import { onMount } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import { BASE_SERVINGS, SERVING_CHOICES } from "./constants.mjs";
	import RecipeContent from "./RecipeContent.svelte";
	import RecipeOfflineStatus from "./RecipeOfflineStatus.svelte";
	import RecipePrintButton from "./RecipePrintButton.svelte";
	import { validateSettings } from "./recipe-logic.mjs";
	import { collectionReturn, takeLegacyRedirect } from "./recipe-navigation.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL, recipePageURL } from "./recipe-url.mjs";
	import ShareRecipe from "./ShareRecipe.svelte";
	import UnitControl from "./UnitControl.svelte";
	import { readRecipePreferences, writeSidePreference, writeUnitPreference } from "./unit-preference.mjs";

	// Keep preference-dependent content hidden until URL and saved settings
	// are resolved. The no-JavaScript stylesheet reveals the static fallback.
	let { recipe } = $props();
	const servingsId = $props.id();
	let interactive = $state(false);
	let message = $state("");
	let returnUrl = $state("");
	let settings = $state({
		servings: BASE_SERVINGS,
		units: "us",
		familyDiners: BASE_SERVINGS,
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

	function setServings(value) {
		const { servings } = validateSettings({ servings: Number(value) });
		settings = { ...settings, servings, familyDiners: servings };
		replacePageURL();
	}

	function setSide(value) {
		settings = {
			...settings,
			familyChoice: { ...settings.familyChoice, [recipe.id]: value },
		};
		replacePageURL();
		writeSidePreference(recipe, value);
	}

	function setUnits(value) {
		const units = validateSettings({ units: value }).units;
		settings = { ...settings, units };
		replacePageURL();
		writeUnitPreference(units);
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
		const parsed = readRecipeURL(url, [recipe], { units: saved.units });
		// Links carrying settings (shares, non-default cards) decide the side;
		// a plain link uses the side saved on this device.
		const explicit = ["servings", "units", "starch"].some((key) => url.searchParams.has(key));
		settings = {
			...settings,
			servings: parsed.servings,
			units: parsed.units,
			familyDiners: parsed.servings,
			familyChoice: explicit || !saved.side ? parsed.familyChoice : { [recipe.id]: saved.side },
		};
		interactive = true;
		return printSession.listen();
	});
</script>

<div class="recipe-page" data-preferences-ready={interactive} aria-busy={!interactive}>
	<section class="recipe-detail print-document" id={recipe.id}>
		<div class="toolbar">
			<a href={returnUrl || `/recipes/${collection}/`} onclick={(event) => { if (returnUrl && history.length > 1 && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); history.back(); } }}>← Back to {returnUrl.startsWith("/recipes/saved/") ? "saved recipes" : returnUrl.startsWith("/recipes/?") || returnUrl === "/recipes/" ? "recipes" : collection}</a>
			<RecipePrintButton {recipe} {settings} class="recipe-enhanced" disabled={!interactive} onPrint={print} />
			<RecipeOfflineStatus {recipe} />
		</div>
		<RecipeContent {recipe} {settings} {interactive} onSideChange={setSide}>
			{#snippet controls()}
			<label class="servings recipe-enhanced" for={servingsId}
				>Servings<NativeSelect id={servingsId} value={settings.servings} disabled={!interactive} onchange={(event) => setServings(event.currentTarget.value)}>
					{#each SERVING_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
				</NativeSelect></label
			>
		<UnitControl units={settings.units} onUnitsChange={setUnits} disabled={!interactive} />
			{/snippet}
		</RecipeContent>
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
