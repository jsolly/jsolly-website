<script>
	import { onMount } from "svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import { BASE_SERVINGS, SERVING_CHOICES } from "./constants.mjs";
	import RecipeContent from "./RecipeContent.svelte";
	import RecipeDownload from "./RecipeDownload.svelte";
	import RecipePrintButton from "./RecipePrintButton.svelte";
	import { validateSettings } from "./recipe-logic.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL } from "./recipe-url.mjs";
	import ShareRecipe from "./ShareRecipe.svelte";
	import UnitControl from "./UnitControl.svelte";
	import { readUnitPreference, replaceUnitURL, writeUnitPreference } from "./unit-preference.mjs";

	// Render the controls before hydration, disabled until their handlers are
	// ready. Native fallbacks live in noscript and never get replaced on load.
	let { recipe } = $props();
	const servingsId = $props.id();
	let interactive = $state(false);
	let message = $state("");
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
		const parsed = readRecipeURL(new URL(window.location.href), [recipe], { units: readUnitPreference() });
		settings = {
			...settings,
			servings: parsed.servings,
			units: parsed.units,
			familyDiners: parsed.servings,
			familyChoice: parsed.familyChoice,
		};
		interactive = true;
		return printSession.listen();
	});
</script>

<div class="recipe-page">
	<section class="recipe-detail print-document" id={recipe.id}>
		<div class="toolbar">
			<a href={`/recipes/${collection}/`}>← Back to {collection}</a>
			<RecipePrintButton {recipe} {settings} class="recipe-enhanced" disabled={!interactive} onPrint={print} />
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
		<RecipeDownload recipes={[recipe]} {settings} disabled={!interactive} />
		<noscript><div class="share"><a href={`/recipes/${recipe.id}/`}>Share recipe link</a></div></noscript>
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
