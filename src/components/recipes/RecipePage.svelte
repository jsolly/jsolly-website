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
	import { collectionReturn } from "./recipe-navigation.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL } from "./recipe-url.mjs";
	import ShareRecipe from "./ShareRecipe.svelte";
	import UnitControl from "./UnitControl.svelte";
	import { readUnitPreference, replaceUnitURL, writeUnitPreference } from "./unit-preference.mjs";

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

	function setServings(value) {
		const { servings } = validateSettings({ servings: Number(value) });
		settings = { ...settings, servings, familyDiners: servings };
	}

	function setSide(value) {
		settings = {
			...settings,
			familyChoice: { ...settings.familyChoice, [recipe.id]: value },
		};
	}

	function setUnits(value) {
		const units = validateSettings({ units: value }).units;
		settings = { ...settings, units };
		replaceUnitURL(units);
		writeUnitPreference(units);
	}

	onMount(() => {
		returnUrl = collectionReturn(history.state, document.referrer, new URL(location.href), collection);
		if (returnUrl) history.replaceState({ ...history.state, recipeReturn: returnUrl }, "");
		const parsed = readRecipeURL(new URL(window.location.href), [recipe], { units: readUnitPreference() });
		settings = {
			...settings,
			servings: parsed.servings,
			units: parsed.units,
			familyDiners: parsed.servings,
			familyChoice: parsed.familyChoice,
		};
		interactive = true;
		const stopPrint = printSession.listen();
		// Reloaded dialog URLs render a standalone page. Back can traverse an
		// earlier same-document collection entry, which needs its collection DOM.
		const restoreCollection = () => { if (location.pathname !== `/recipes/${recipe.id}/`) location.reload(); };
		window.addEventListener("popstate", restoreCollection);
		return () => { stopPrint(); window.removeEventListener("popstate", restoreCollection); };
	});
</script>

<div class="recipe-page" data-preferences-ready={interactive} aria-busy={!interactive}>
	<section class="recipe-detail print-document" id={recipe.id}>
		<div class="toolbar">
			<a href={returnUrl || `/recipes/${collection}/`} onclick={(event) => { if (returnUrl && history.length > 1 && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); history.back(); } }}>← Back to {returnUrl.startsWith("/recipes/saved/") ? "saved recipes" : returnUrl.startsWith("/recipes/?") || returnUrl === "/recipes/" || returnUrl.startsWith("/recipes/#") ? "recipes" : collection}</a>
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
