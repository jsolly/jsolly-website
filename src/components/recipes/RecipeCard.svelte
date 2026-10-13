<script>
	import Button from "../../lib/components/ui/button.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import { BASE_SERVINGS } from "./constants.mjs";
	import NutritionPills from "./NutritionPills.svelte";
	import RecipeBadge from "./RecipeBadge.svelte";
	import {
		formatNutrition,
		servingNutrition,
		smoothiePortionNutrition,
	} from "./recipe-logic.mjs";

	// One recipe's card in the library grid: its group, photo, title, active
	// time, net carbs per serving and appliances. `href` is the
	// recipe page with the reader's servings and family side.
	let { recipe, href, servings = BASE_SERVINGS } = $props();
	// Diet labels already live in the card badge; retain canonical source titles.
	const cardTitle = $derived(recipe.title
		.replace(/\(\s*(?:(?:keto|low[ -]carb)\s*(?:\+|-)?\s*)+\)/giu, "")
		.replace(/\b(?:keto|low[ -]carb)\b(?:\s*\+\s*)?/giu, "")
		.replace(/\s+/gu, " ").trim()
		.replace(/^./u, (letter) => letter.toUpperCase()));
</script>

<article class="recipe-card">
	<div class="card-top"><RecipeBadge group={recipe.group} /></div>
	{#if recipe.image}<figure class="card-photo"><img src={recipe.image.cardSrc} srcset={recipe.image.cardSrcset} sizes="(max-width:600px) 340px, (max-width:1000px) 420px, 360px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="lazy" decoding="async" /></figure>{/if}
	<h3><a class="title-button" data-recipe-id={recipe.id} {href}>{cardTitle}</a></h3>
	<div class="card-details">
		<dl class="card-numbers">
			<div>
				<dt>{recipe.sourceRecipe ? "Prep time" : "Active time"}</dt>
				<dd class="active-time"><span class="time-number" class:unknown={recipe.activeMinutes === null}>{recipe.activeMinutes === null ? "Not provided" : recipe.activeMinutes}</span>{#if recipe.activeMinutes !== null}<span class="time-unit">min</span>{/if}</dd>
			</div>
			<div>
				<dt>{recipe.type === "smoothie" ? "Net Carbs (8 oz)" : "Net carbs per serving"}</dt>
				<dd class="carb-value">{recipe.type === "smoothie" ? formatNutrition(smoothiePortionNutrition(recipe).net_carbs_g, "g", 1) : formatNutrition(servingNutrition(recipe, BASE_SERVINGS).net_carbs_g, "g", 1)}</dd>
			</div>
			<div>
				<dt>Kitchen stuff needed</dt>
				<dd class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name} />{/each}</dd>
			</div>
		</dl>
		<div class="card-nutrition"><NutritionPills {recipe} {servings} /></div>
	</div>
	<div class="card-actions"><Button class="open-button" {href} aria-label={`Open recipe: ${cardTitle}`}>Open recipe <span aria-hidden="true">→</span></Button></div>
</article>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
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
			flex-wrap: wrap;
			justify-content: space-between;
			gap: 10px;
			align-items: center;
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
		.recipe-card h3 {
			margin: 18px 0 8px;
		}
		/* Keep card links consistent with the recipe palette. */
		.recipe-card .title-button {
			display: block;
			font: 600 1.5rem / 1.18 var(--font-heading);
			color: var(--recipe-ink);
		}
		.recipe-card .title-button:hover {
			color: var(--recipe-ink);
			text-decoration: underline;
			text-decoration-color: currentColor;
			text-underline-offset: 4px;
		}
		.card-nutrition:has(> :global(.nutrition-pills)) {
			margin-top: 14px;
		}
		.card-nutrition :global(.nutrition-pills) {
			padding: 0;
			margin: 0;
		}
		.card-nutrition :global(.nutrition-pills li) {
			margin: 0;
		}
		.card-numbers {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 16px 20px;
			border-top: 1px solid var(--recipe-line);
			padding-top: 13px;
			margin: 12px 0 0;
		}
		.card-numbers > div {
			display: grid;
			grid-template-rows: 1fr auto;
			gap: 6px;
		}
		.card-numbers > div:last-child {
			grid-column: 1 / -1;
			display: grid;
			gap: 8px;
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
			margin: 0;
		}
		.card-numbers .active-time {
			display: flex;
			align-items: baseline;
			gap: 6px;
		}
		.card-numbers .carb-value {
			font-size: 1.5rem;
			line-height: 1.1;
			font-weight: 700;
			letter-spacing: -0.04em;
		}
		.time-number {
			font-size: 2.5rem;
			line-height: 1.1;
			font-weight: 700;
			letter-spacing: -0.04em;
		}
		.time-number.unknown { font-size: 1rem; letter-spacing: normal; }
		.time-unit {
			font-size: 1rem;
			font-weight: 600;
		}
		.appliance-icons {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
			justify-content: flex-start;
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
		.card-actions :global(.open-button) {
			width: 100%;
			min-height: 48px;
			font-weight: 700;
			font-size: 1rem;
			gap: 10px;
			color: var(--recipe-accent-text);
			background: var(--recipe-accent);
			text-decoration: none;
		}
		.card-actions :global(.open-button:hover) {
			color: var(--recipe-accent-text);
			background: color-mix(in oklch, var(--recipe-accent), var(--recipe-accent-text) 15%);
			text-decoration: none;
		}
		@media (max-width: 600px) {
			.recipe-card {
				padding: 18px;
			}
			.recipe-card h3 {
				margin-top: 15px;
			}
		}
		@media print {
			.card-photo {
				display: none;
			}
		}
	}
</style>
