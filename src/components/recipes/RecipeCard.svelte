<script>
	import ApplianceIcon from "./ApplianceIcon.svelte";
	import { BASE_SERVINGS } from "./constants.mjs";
	import RecipeBadge from "./RecipeBadge.svelte";
	import {
		servingNutrition,
		smoothiePortionNutrition,
	} from "./recipe-logic.mjs";

	// One recipe's card in the library grid: its group, photo, title, active
	// time, net carbs at the chosen servings and appliances. `href` is the
	// recipe page with the reader's servings and family side.
	let { recipe, servings, href } = $props();
</script>

<article class="recipe-card">
	<div class="card-top"><RecipeBadge group={recipe.group} /></div>
	{#if recipe.image}<figure class="card-photo"><img src={recipe.image.cardSrc} srcset={recipe.image.cardSrcset} sizes="(max-width:600px) 340px, (max-width:1000px) 420px, 360px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="lazy" decoding="async" /></figure>{/if}
	<h3><a class="title-button" data-recipe-id={recipe.id} {href}>{recipe.title}</a></h3>
	<dl class="card-numbers">
		<div>
			<dt>Active time</dt>
			<dd class="active-time"><span class="time-number">{recipe.activeMinutes}{servings > BASE_SERVINGS ? "+" : ""}</span><span class="time-unit">min</span></dd>
		</div>
		<div>
			<dt>{recipe.type === "smoothie" ? "Net Carbs (8 oz)" : `Net carbs per ${servings} servings`}</dt>
			<dd>{recipe.type === "smoothie" ? smoothiePortionNutrition(recipe).net_carbs_g.toFixed(1) : Math.round(servingNutrition(recipe, servings).net_carbs_g * servings)} g</dd>
		</div>
		<div>
			<dt>Appliances needed</dt>
			<dd class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name} />{/each}</dd>
		</div>
	</dl>
	<div class="card-actions"><a class="open-button" {href}>See recipe</a></div>
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
		/* The library's link colour outranks this one, as in awesome-blog. */
		.title-button {
			display: block;
			font: 600 1.5rem / 1.18 var(--font-heading);
			color: var(--recipe-ink);
		}
		.title-button:hover {
			text-decoration: underline;
			text-underline-offset: 4px;
		}
		.card-numbers {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 12px;
			border-top: 1px solid var(--recipe-line);
			padding-top: 13px;
			margin: 12px 0 0;
		}
		.card-numbers > div {
			display: grid;
			grid-template-rows: 1fr auto;
		}
		.card-numbers > div:last-child {
			grid-column: 1 / -1;
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
			margin: 4px 0 0;
		}
		.card-numbers .active-time {
			display: flex;
			align-items: baseline;
			gap: 6px;
		}
		.time-number {
			font-size: 2.4rem;
			line-height: 1.1;
			font-weight: 700;
			letter-spacing: -0.04em;
		}
		.time-unit {
			font-size: 1rem;
			font-weight: 600;
		}
		.appliance-icons {
			display: flex;
			align-items: center;
			gap: 10px;
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
		.open-button {
			font-weight: 700;
			font-size: 0.84rem;
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
