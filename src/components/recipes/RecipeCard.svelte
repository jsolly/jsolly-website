<script>
	import Check from "@lucide/svelte/icons/check";
	import Button from "../../lib/components/ui/button.svelte";
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import { BASE_SERVINGS } from "./constants.mjs";
	import NutritionPills from "./NutritionPills.svelte";
	import RecipePrintButton from "./RecipePrintButton.svelte";
	import {
		formatNutrition,
		servingNutrition,
		smoothiePortionNutrition,
	} from "./recipe-logic.mjs";

	// One recipe's card in the library grid: its group, photo, title, active
	// time, net carbs per serving and appliances. `href` is the
	// recipe page with the reader's servings and family side. `madeOn` is the
	// local date the reader last made it, shown as a "Made it!" badge; server
	// fragments never pass one.
	let { recipe, href, madeOn = "", servings = BASE_SERVINGS, settings, onPrint, disabled = false } = $props();
	// Diet labels live with the other highlights; retain canonical source titles.
	const cardTitle = $derived(recipe.title
		.replace(/\(\s*(?:(?:keto|low[ -]carb)\s*(?:\+|-)?\s*)+\)/giu, "")
		.replace(/\b(?:keto|low[ -]carb)\b(?:\s*\+\s*)?/giu, "")
		.replace(/\s*\(family favorite\)/giu, "")
		.replace(/\s+/gu, " ").trim()
		.replace(/^./u, (letter) => letter.toUpperCase()));
	const netCarbs = $derived("netCarbs" in recipe ? recipe.netCarbs : recipe.type === "smoothie" ? smoothiePortionNutrition(recipe).net_carbs_g : servingNutrition(recipe, BASE_SERVINGS).net_carbs_g);

	function deferImage(node) {
		if (!("IntersectionObserver" in window)) { node.src = recipe.image.cardSrc; node.srcset = recipe.image.cardSrcset; return; }
		const src = recipe.image.cardSrc, srcset = recipe.image.cardSrcset;
		node.removeAttribute("src"); node.removeAttribute("srcset");
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			if (srcset) node.setAttribute("srcset", srcset);
			if (src) node.setAttribute("src", src);
			observer.disconnect();
		}, { rootMargin: "300px" });
		observer.observe(node);
		return () => observer.disconnect();
	}
</script>

<article class="recipe-card">

	{#if recipe.image}<figure class="card-photo"><img class="deferred-card-image" {@attach deferImage} sizes="(max-width:600px) 340px, (max-width:1000px) 420px, 360px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="lazy" decoding="async" /><noscript><img src={recipe.image.cardSrc} srcset={recipe.image.cardSrcset} sizes="(max-width:600px) 340px, (max-width:1000px) 420px, 360px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="lazy" decoding="async" /></noscript></figure>{/if}
	<h3><a class="title-button" data-recipe-id={recipe.id} {href}>{cardTitle}</a></h3>
	{#if madeOn}<p class="made-badge"><span class="made-check" aria-hidden="true"><Check size={10} strokeWidth={3.5} /></span>Made it!</p>{/if}
	<div class="card-details">
		<dl class="card-numbers">
			<div class="card-metric">
				<dt>{recipe.sourceRecipe ? "Prep time" : "Active time"}</dt>
				<dd class="active-time"><span class="time-number" class:unknown={recipe.activeMinutes === null}>{recipe.activeMinutes === null ? "Not provided" : recipe.activeMinutes}</span>{#if recipe.activeMinutes !== null}<span class="time-unit">min</span>{/if}</dd>
			</div>
			<div class="card-metric">
				<dt>{recipe.type === "smoothie" ? "Net Carbs (8 oz)" : "Net carbs per serving"}</dt>
				<dd class="carb-value">{netCarbs === null ? "Not provided" : formatNutrition(netCarbs, "g")}</dd>
			</div>
			<div>
				<dt>Kitchen stuff needed</dt>
				<dd class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name} />{/each}</dd>
			</div>
		</dl>
		<div class="card-nutrition"><NutritionPills {recipe} {servings} flags={recipe.nutritionPills ? Object.fromEntries(recipe.nutritionPills.map((pill) => [pill.key, true])) : undefined} /></div>
	</div>
	<div class="card-actions"><Button class="open-button" {href} aria-label={`Open recipe: ${cardTitle}`}>Open recipe <span aria-hidden="true">→</span></Button>{#if onPrint}<RecipePrintButton {recipe} {settings} {onPrint} {disabled} />{/if}</div>
</article>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.recipe-card {
			position: relative;
			background: var(--recipe-paper);
			border: 1px solid var(--recipe-line);
			border-radius: 16px;
			display: flex;
			flex-direction: column;
			padding: 20px;
			min-width: 0;
			row-gap: 0;
		}
		.card-photo {
			margin: 0;
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
		/* A sticker pinned over the card's top-right corner, tilted. */
		.made-badge {
			position: absolute;
			top: -7px;
			right: -6px;
			z-index: 1;
			display: inline-flex;
			align-items: center;
			gap: 5px;
			margin: 0;
			padding: 3px 9px 3px 4px;
			border: 1px solid color-mix(in oklch, var(--recipe-made) 35%, transparent);
			border-radius: 999px;
			background: var(--recipe-badge);
			color: var(--recipe-made);
			font: italic 700 0.72rem / 1 var(--font-heading);
			transform: rotate(10deg);
			box-shadow: 0 2px 6px rgb(0 0 0 / 0.14);
		}
		.made-check {
			display: grid;
			place-items: center;
			width: 16px;
			height: 16px;
			border-radius: 50%;
			background: var(--recipe-made);
			color: var(--recipe-badge);
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
		/* Both metrics start at their column's left edge. Active time stays left
		   aligned; the carb figure is centred under its label and, through subgrid
		   (labels in one row, figures in the next), on the time figure's height. */
		.card-numbers > .card-metric {
			grid-row: span 2;
			grid-template-rows: subgrid;
			row-gap: 6px;
			justify-self: start;
		}
		.card-metric dt {
			align-self: end;
		}
		.card-metric dd {
			align-self: center;
		}
		.card-metric .carb-value {
			justify-self: center;
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
		.card-details { margin-bottom: 16px; }
		.card-actions {
			margin-top: auto;
			display: flex;
			flex-direction: column;
			align-items: stretch;
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
			.card-photo,
			.made-badge {
				display: none;
			}
		}
	}
</style>
