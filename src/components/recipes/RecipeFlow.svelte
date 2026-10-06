<script>
	import Button from "../../lib/components/ui/button.svelte";
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import DialogRoot from "../../lib/components/ui/dialog.svelte";
	import DialogContent from "../../lib/components/ui/dialog-content.svelte";
	import DialogDescription from "../../lib/components/ui/dialog-description.svelte";
	import DialogTitle from "../../lib/components/ui/dialog-title.svelte";
	import { ingredientIcon } from "./ingredient-icon.mjs";
	import { flowGrid } from "./trn-logic.mjs";

	// The recipe's Tabular Recipe Notation table. Interactive, each ingredient
	// row has a check to tick as it goes in; the printed copy has plain boxes.
	let { recipe, settings, interactive = true, headingLevel = 3 } = $props();
	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const helpId = `${uid}-help`;
	let methodOpen = $state(false);
	let methodContent = $state(null);
	const grid = $derived(flowGrid(recipe, settings));
	let checks = $state([]);

	function toggle(row) {
		checks = checks.includes(row)
			? checks.filter((checked) => checked !== row)
			: [...checks, row];
	}

	// Opening the method dialog puts focus on the dialog itself, so a screen
	// reader starts at its title rather than on the close button at the end.
	function focusMethodDialog(event) {
		event.preventDefault();
		methodContent?.focus();
	}
</script>

<section class="trn-view">
	<div class="flow-toolbar"><svelte:element this={`h${headingLevel}`} id={headingId} class="flow-heading">{recipe.type === "smoothie" ? "Preparation flow" : "Cooking flow"}</svelte:element></div>
	<p class="trn-help" id={helpId}>Read left to right. Each merged cell acts on the ingredient rows feeding into it. Parallel branches stay separate until plating.</p>
	<div class="trn-frame">
		<!-- Keyboard focus lets a keyboard user scroll the wide table sideways. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be reachable by keyboard to scroll it -->
		<section class="trn-scroll" tabindex="0" aria-labelledby={headingId} aria-describedby={helpId}>
			<table class="trn-table">
				<tbody>
					{#each grid.prep as text, i (i)}<tr><td colspan={grid.columns} class="trn-prep">{text}</td></tr>{/each}
					{#if interactive}<tr class="reset-checks-row"><td colspan={grid.columns}><Button variant="ghost" class="reset-checks" type="button" onclick={() => (checks = [])}>Reset cooking checks</Button></td></tr>{/if}
					{#each grid.rows as row, i (i)}
						<tr>
							{#each row.cells as cell (cell.col)}
								{#if cell.kind === "ingredient"}
									<th scope="row" colspan={cell.colspan} class="trn-ingredient" class:checked={checks.includes(i)}>
										<label for={`${uid}-${i}`}
											>{#if interactive}<Checkbox id={`${uid}-${i}`} aria-label={`${cell.text} ${cell.name}, added`} checked={checks.includes(i)} onCheckedChange={() => toggle(i)} />{:else}<input id={`${uid}-${i}`} type="checkbox" aria-label={`${cell.text} ${cell.name}, added`} />{/if}<span
												><strong>{cell.text}</strong> {cell.name}{#if ingredientIcon(cell.name)}
													<span class="ingredient-icon" aria-hidden="true">{ingredientIcon(cell.name)}</span>{/if}<small>{cell.state}</small></span
											></label
										>
									</th>
								{:else}
									<td rowspan={cell.rowspan} colspan={cell.colspan} class="trn-operation">{cell.text}</td>
								{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	</div>
	{#if interactive}
		<Button variant="ghost" class="learn-method" type="button" onclick={() => (methodOpen = true)}>Learn more about Tabular Recipe Notation</Button>
		<DialogRoot bind:open={methodOpen}>
			<DialogContent bind:ref={methodContent} class="method-dialog" tabindex={-1} showCloseButton={false} onOpenAutoFocus={focusMethodDialog}>
				<DialogTitle>Tabular Recipe Notation</DialogTitle>
				<DialogDescription class="visually-hidden">How to read a cooking dependency table.</DialogDescription>
				<p>This format connects ingredients to cooking steps in a table. Read from left to right: each ingredient row feeds into the operation beside it. A merged operation cell uses all the ingredient rows alongside it.</p>
				<p>Follow each branch across the table. Separate branches let you prepare parts of the meal independently; they join when those parts are combined or plated. Preparation notes at the top apply before you start.</p>
				<p>The table shows which ingredients each step uses. Preparation notes at the top list the equipment and steps to complete first. Tick each ingredient row as you add that portion; split ingredients have separate checks.</p>
				<p>The format comes from Michael Chu’s <a href="https://www.cookingforengineers.com/">Cooking for Engineers <span aria-hidden="true">↗</span></a>.</p>
				<Button variant="outline" onclick={() => (methodOpen = false)}>Close and continue recipe</Button>
			</DialogContent>
		</DialogRoot>
	{:else}
		<a class="learn-method" href="https://www.cookingforengineers.com/">Learn more about Tabular Recipe Notation <span aria-hidden="true">↗</span></a>
	{/if}
</section>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		:global(.learn-method) {
			border: 0;
			background: none;
			color: var(--recipe-accent, #355b40);
			text-decoration: underline;
			padding: 8px 0;
			margin-bottom: 12px;
			cursor: pointer;
			font: inherit;
		}
		:global(.method-dialog) {
			max-width: 540px;
			width: calc(100% - 32px);
			max-height: 80vh;
			overflow: auto;
			border: 1px solid var(--recipe-input-border);
			border-radius: 14px;
			padding: 24px;
			color: var(--recipe-ink);
			background: var(--recipe-flow-paper);
		}
		:global(.method-dialog p) {
			line-height: 1.6;
		}
		:global(.method-dialog button) {
			min-height: 44px;
			padding: 8px 14px;
		}
		:global(.method-dialog:focus-visible),
		:global(.learn-method:focus-visible) {
			outline: 3px solid var(--recipe-focus);
			outline-offset: 3px;
		}
		.ingredient-icon {
			display: inline-block;
			width: 1.4em;
			margin-left: 4px;
			font-size: 1.1em;
			line-height: 1;
			vertical-align: baseline;
		}
		.trn-ingredient label {
			display: flex;
			align-items: flex-start;
			gap: 8px;
			font-weight: 400;
		}
		/* The blog's button rule would make the bits-ui checkbox (a <button>) a
		   filled pill; this draws it as a checkbox, filled only when checked. Its
		   border uses the muted ink: --recipe-input-border is about 2:1 on the
		   light table, under WCAG 1.4.11's 3:1 for a control's boundary. */
		.trn-ingredient :global([data-slot="checkbox"]) {
			width: 19px;
			height: 19px;
			flex-shrink: 0;
			padding: 0;
			border: 1px solid var(--recipe-muted);
			border-radius: 4px;
			background: transparent;
			color: var(--recipe-ink);
			accent-color: var(--recipe-accent);
		}
		.trn-ingredient :global([data-slot="checkbox"][data-state="checked"]) {
			border-color: var(--recipe-accent);
			background: var(--recipe-accent);
			color: var(--recipe-accent-text);
		}
		.trn-ingredient.checked span {
			opacity: 0.6;
			text-decoration: line-through;
		}
		.flow-toolbar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			flex-wrap: wrap;
			margin-bottom: 10px;
		}
		/* Only the library dialog's h3 flow heading loses its margin, as in SRC;
		   the recipe page's h2 keeps the blog heading spacing (live parity). */
		h3.flow-heading {
			margin: 0;
		}
		:global(.reset-checks) {
			font-size: 0.8rem;
			border: 1px solid var(--recipe-line, #d4dacb);
			background: transparent;
			color: var(--recipe-ink, #25392b);
			border-radius: 8px;
			padding: 8px 12px;
			min-height: 44px;
		}
		.trn-view {
			margin: 26px 0;
			max-width: 100%;
			min-width: 0;
		}
		.trn-help {
			font-size: 0.85rem;
			line-height: 1.5;
			max-width: 55rem;
		}
		.trn-frame {
			max-width: 100%;
			border: 1px solid var(--recipe-line, #d4dacb);
			border-radius: 6px;
			overflow: hidden;
			background: var(--recipe-flow-paper);
		}
		.trn-view :global(.trn-scroll) {
			overflow-x: auto;
			max-width: 100%;
		}
		.trn-frame:has(.trn-scroll:focus-visible) {
			outline: 3px solid var(--recipe-accent, #365b3d);
			outline-offset: 3px;
		}
		.trn-view :global(.trn-scroll:focus-visible) {
			outline: none;
		}
		.trn-view :global(.trn-table) {
			border-collapse: collapse;
			border: 1px solid var(--recipe-line, #d4dacb);
			border-spacing: 0;
			width: 100%;
			min-width: 760px;
			table-layout: auto;
			margin: 0;
			font-size: 14px;
			line-height: 1.4;
			background: var(--recipe-flow-paper);
			color: var(--recipe-flow-ink);
		}
		.trn-view :global(caption) {
			text-align: left;
			padding: 10px;
			font-size: 13px;
			background: var(--recipe-flow-caption);
			color: var(--recipe-flow-ink);
		}
		.trn-view :global(th),
		.trn-view :global(td) {
			border: 1px solid var(--recipe-line, #d4dacb);
			padding: 8px;
			vertical-align: middle;
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.trn-view :global(.trn-ingredient) {
			font-weight: 400;
			text-align: left;
			min-width: 220px;
		}
		.trn-view :global(.trn-ingredient small) {
			display: block;
			font-size: 11px;
			line-height: 1.3;
			margin-top: 3px;
		}
		.trn-view :global(.trn-operation) {
			text-align: center;
			min-width: 100px;
			max-width: 200px;
		}
		.trn-view :global(.reset-checks-row td) {
			text-align: left;
		}
		.trn-view :global(.trn-prep) {
			text-align: center;
			background: var(--recipe-flow-prep);
		}
		@media print {
			.reset-checks-row,
			.flow-toolbar :global(button),
			:global(.learn-method),
			:global(.method-dialog),
			.trn-ingredient :global([data-slot="checkbox"]) {
				display: none;
			}
			.trn-view {
				margin: 10pt 0;
				break-inside: avoid;
			}
			.trn-help {
				display: none;
			}
			h3.flow-heading {
				font: 700 12pt/1.2 Georgia, serif;
				margin: 6pt 0;
			}
			.trn-frame {
				overflow: visible;
				border: 0;
				border-radius: 0;
			}
			.trn-view :global(.trn-scroll) {
				overflow: visible;
			}
			.trn-view :global(.trn-table) {
				min-width: 0;
				width: 100%;
				border: 1px solid #555;
				table-layout: fixed;
				font-size: 8pt;
				line-height: 1.2;
				background: white;
			}
			.trn-view :global(th),
			.trn-view :global(td) {
				padding: 3pt;
				min-width: 0;
				max-width: none;
				line-height: 1.2;
				font-size: 8pt;
				border-color: #555;
			}
			.trn-view :global(.trn-ingredient small) {
				font-size: 7pt;
			}
			.trn-view :global(caption) {
				font-size: 8pt;
				padding: 4pt;
			}
		}
	}
</style>
