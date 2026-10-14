<script>
	import { printGroupLabels } from "./constants.mjs";
	import { UNIT_LABELS } from "./ingredient-units.mjs";
	import { nutrientAmount } from "./nutrition.mjs";
	import RecipeFlow from "./RecipeFlow.svelte";
	import { nutritionSummary, recipeDocument } from "./recipe-export.mjs";

	// The printed copy of one or more recipes: hidden on screen, shown in print.
	let { recipes = [], settings } = $props();
	const documents = $derived(
		recipes.map((recipe) => recipeDocument(recipe, settings)),
	);


	// The vitamins and minerals worth printing, highest daily value first.
	function dailyValues(nutrients) {
		return nutrients
			.filter((nutrient) => nutrient.amount !== null && nutrient.percent !== 0)
			.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
	}
</script>

<section class="print-document" aria-label="Printable recipes">
	{#if documents.length > 1}
		<header class="packet-heading">
			<h1 class="print-title">All recipes</h1>
			<p>{documents.length} recipes · {settings.servings} servings each · {UNIT_LABELS[settings.units]} cooking measures</p>
			<p>Each recipe starts on a new page. Safe doneness and appliance capacity take priority over the time estimate.</p>
		</header>
	{/if}
	{#each documents as document, i (document.recipeId)}
		<article class="print-meal" class:new-page={i > 0} aria-label={document.title}>
			<h1 class="print-title">{document.title}</h1>
			<p class="meal-facts">{printGroupLabels[document.group] || document.group} · {document.servings} servings · {UNIT_LABELS[document.units]} measures · {document.activeMinutes === null ? "Prep time not provided" : `${document.activeMinutes} min ${document.timeBasis} per four-serving batch`}</p>
			<p class="total-time">Total time: {document.totalTime}</p>
			<p>{document.summary}</p>
			<p>{document.attentionSummary}</p>
			<p class="important">{document.capacity}</p>
			<p>{document.timingNote}</p>
			<p class="small">{document.measurementPolicy}</p>
			<p class="small">{document.disclaimer}</p>
			<RecipeFlow recipe={recipes[i]} {settings} printOnly headingLevel={2} />
			<h2>Ingredients</h2>
			<ul class="ingredient-list">
				{#each document.ingredients as ingredient, index (index)}
					<li><strong>{ingredient.quantity}</strong> {ingredient.name}{#if ingredient.state || ingredient.note}<span class="ingredient-note">{[ingredient.state, ingredient.note].filter(Boolean).join(" · ")}</span>{/if}</li>
				{/each}
			</ul>
			{#if document.familyIngredient}
				<div class="family-starch">
					<h2>Separate family starch · {document.familyDiners} diners</h2>
					<p><strong>{document.familyIngredient.quantity}</strong> {document.familyIngredient.name}</p>
					<p>{document.familyIngredient.state} · {document.familyIngredient.note}</p>
				</div>
			{:else if document.group === "shared"}
				<p>No family starch is included for this printout. The shared main serves all {document.servings} people.</p>
			{/if}
			<h2>Before you start</h2>
			<ul>{#each document.equipment as item (item)}<li>{item}</li>{/each}</ul>
			<p>{document.safety}</p>
			<h2>Cook</h2>
			<ol class="method-list">{#each document.steps as step (step.title)}<li><strong>{step.title}</strong><p>{step.text}</p></li>{/each}</ol>
			<h2>Where your attention goes</h2>
			<ul>{#each document.timeline as event (event.phase)}<li><strong>{event.phase} · {event.duration}</strong><p>{event.attention}</p></li>{/each}</ul>
			<p class="small">Stages can overlap. Do not add every row as separate elapsed time. Safe endpoints and actual appliance behavior override the estimate.</p>
			{#if document.fallback}
				<h2>Capacity fallback</h2>
				<p>{document.fallback}</p>
			{/if}
			<h2>Why this works</h2>
			<p>{document.flavorRationale}</p>
			<ul>{#each document.tips as tip (tip)}<li>{tip}</li>{/each}</ul>
			<h2>{document.nutritionHeading}</h2>
			<p>{nutritionSummary(document.nutrition)}</p>
			<p>{document.nutritionNote}</p>
			{#if document.sourceRecipe?.nutritionEstimate}<h3>Nutrition assumptions</h3><ul>{#each document.sourceRecipe.nutritionEstimate.assumptions as assumption (assumption)}<li>{assumption}</li>{/each}</ul>{/if}
			<dl class="daily-values">
				{#each dailyValues(document.dailyNutrition) as nutrient (nutrient.key)}
					<div><dt>{nutrient.label}</dt><dd>{nutrientAmount(nutrient.amount)} {nutrient.unit} · {nutrient.percent === null ? "—" : `${nutrient.percent}% DV`}</dd></div>
				{/each}
			</dl>
			<p><strong>Listed allergens:</strong> {document.allergens.length ? document.allergens.join(", ") : "None in the specified ingredients"}. Check purchased labels and cross-contact.</p>
			<h2>First-cook checks</h2>
			<ul>{#each document.limitations as limitation (limitation)}<li>{limitation}</li>{/each}</ul>
			<h2>Leftovers</h2>
			<p>{document.leftovers}</p>
			<h2>Sources</h2>
			<ul class="source-list">{#each document.sources as source (source.url)}<li>{source.title}<br /><a href={source.url}>{source.url}</a></li>{/each}</ul>
			<p class="small">{document.disclaimer}</p>
		</article>
	{/each}
</section>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.print-document {
			display: none;
		}
		@media print {
			.print-document {
				display: block;
				font: 11pt/1.4 Georgia, serif;
				color: #000;
				background: #fff;
				overflow: visible;
				width: 100%;
				max-width: none;
			}
			/* biome-ignore-start lint/complexity/noImportantStyles: the print reset must override the colours, backgrounds and shapes every nested recipe component sets, whatever their specificity or stylesheet order */
			.print-document :global(*) {
				color: #000 !important;
				background: transparent !important;
				box-shadow: none !important;
				border-radius: 0 !important;
				letter-spacing: normal !important;
			}
			/* biome-ignore-end lint/complexity/noImportantStyles: end of the print reset */
			.print-document h1 {
				font: 700 20pt/1.15 Georgia, serif;
				margin: 0 0 10pt;
				break-after: avoid;
			}
			.print-document h2 {
				font: 700 13pt/1.2 Georgia, serif;
				margin: 13pt 0 5pt;
				break-after: avoid;
			}
			.print-document p {
				font-size: 11pt;
				line-height: 1.4;
				margin: 4pt 0 8pt;
			}
			.print-document ul,
			.print-document ol {
				margin: 4pt 0 10pt;
				padding-left: 18pt;
			}
			.print-document li {
				font-size: 11pt;
				line-height: 1.4;
				margin: 0 0 5pt;
				break-inside: avoid;
			}
			.print-document a {
				font-size: 9pt;
				text-decoration: none;
				overflow-wrap: anywhere;
				word-break: break-word;
			}
			.ingredient-note {
				display: block;
				margin-top: 2pt;
			}
			.print-document .small,
			.print-document .ingredient-note {
				font-size: 9pt;
				line-height: 1.35;
			}
			.daily-values {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 5pt;
				font-size: 9pt;
			}
			.daily-values dd {
				margin: 0;
			}
			.daily-values > div {
				break-inside: avoid;
			}
			.packet-heading {
				margin-bottom: 18pt;
				border-bottom: 1pt solid #777;
				padding-bottom: 8pt;
			}
			.important {
				border-left: 2pt solid #555;
				padding-left: 8pt;
			}
			.family-starch {
				border-left: 1pt solid #777;
				padding-left: 8pt;
			}
			.new-page {
				break-before: page;
			}
			.method-list li p {
				margin-top: 3pt;
			}
		}
	}
</style>
