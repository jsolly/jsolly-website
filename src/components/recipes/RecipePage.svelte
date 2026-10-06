<script>
	import { onMount } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import NativeSelect from "../../lib/components/ui/native-select.svelte";
	import { BASE_SERVINGS, groupBadges, SERVING_CHOICES } from "./constants.mjs";
	import RecipeBody from "./RecipeBody.svelte";
	import RecipePrint from "./RecipePrint.svelte";
	import { validateSettings } from "./recipe-logic.mjs";
	import { createRecipePrintSession } from "./recipe-print-session.mjs";
	import { readRecipeURL } from "./recipe-url.mjs";
	import ShareRecipe from "./ShareRecipe.svelte";

	// One recipe's page (/recipes/<id>/). The server render is the no-JavaScript
	// page; on mount it reads ?servings= and ?starch= and turns interactive.
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
		message = (await printSession.print()) ?? message;
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

	onMount(() => {
		const parsed = readRecipeURL(new URL(window.location.href), [recipe]);
		settings = {
			...settings,
			servings: parsed.servings,
			familyDiners: parsed.servings,
			familyChoice: parsed.familyChoice,
		};
		interactive = true;
		return printSession.listen();
	});
</script>

<div class="recipe-page">
	<section class="recipe-detail" id={recipe.id}>
		<div class="toolbar">
			<a href={`/recipes/${collection}/`}>← Back to {collection}</a>
			{#if interactive}<Button variant="outline" onclick={print}>Print recipe</Button>{/if}
		</div>
		<span class="badge">{groupBadges[recipe.group]}</span>
		<h1>{recipe.title}</h1>
		<p>{recipe.summary}</p>
		{#if interactive}
			<label class="servings" for={servingsId}
				>Servings<NativeSelect id={servingsId} value={settings.servings} onchange={(event) => setServings(event.currentTarget.value)}>
					{#each SERVING_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
				</NativeSelect></label
			>
		{/if}
		<RecipeBody {recipe} {settings} {interactive} headingLevel={2} onSideChange={setSide} />
		{#if interactive}
			<ShareRecipe {recipe} {settings} />
		{:else}
			<div class="share"><a href={`/recipes/${recipe.id}/`}>Share recipe link</a></div>
		{/if}
		<p role="status">{message}</p>
	</section>
	<div class="print-output"><RecipePrint recipes={[recipe]} {settings} /></div>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.print-output {
			display: none;
		}
		@media print {
			.print-output {
				display: block;
			}
			.recipe-detail {
				display: none;
			}
		}
		.recipe-detail {
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			border: 1px solid var(--recipe-line);
			border-radius: 20px;
			padding: 28px;
			font: 16px/1.55 var(--font-body);
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
			margin-bottom: 24px;
		}
		a {
			color: var(--recipe-accent);
		}
		h1 {
			font: 600 clamp(2rem, 4vw, 3rem) / 1.13 var(--font-heading);
		}
		.badge {
			display: inline-block;
			background: var(--recipe-badge);
			padding: 4px 10px;
			border-radius: 4px;
			font-size: 0.75rem;
		}
		.share {
			margin-top: 24px;
			border-top: 1px solid var(--recipe-line);
			padding-top: 16px;
		}
		@media (max-width: 600px) {
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
