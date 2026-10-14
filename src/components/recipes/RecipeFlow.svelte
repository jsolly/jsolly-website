<script>
	import Button from "../../lib/components/ui/button.svelte";
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import DialogRoot from "../../lib/components/ui/dialog.svelte";
	import DialogContent from "../../lib/components/ui/dialog-content.svelte";
	import DialogDescription from "../../lib/components/ui/dialog-description.svelte";
	import DialogTitle from "../../lib/components/ui/dialog-title.svelte";
	import { cookingNotes, OMITTED_PREPARATION } from "./cooking-notes.mjs";
	import { cookText } from "./display-units.mjs";
	import { ingredientIcon } from "./ingredient-icon.mjs";
	import { flowGrid } from "./trn-logic.mjs";

	// The recipe's Tabular Recipe Notation table. Interactive, each ingredient
	// row has a check to tick as it goes in; the printed copy has plain boxes.
	let { recipe, settings, interactive = true, printOnly = false, headingLevel = 3 } = $props();
	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const helpId = `${uid}-help`;
	let methodOpen = $state(false);
	let methodContent = $state(null);
	const grid = $derived(flowGrid(recipe, settings));
	const preparation = $derived(grid.prep.filter((text) => printOnly || !OMITTED_PREPARATION.test(text)));
	let checks = $state([]);
	// The same allocation leaves feed both views, with one shared check state.
	const mobileFlow = $derived.by(() => {
		let row = 0;
		function branch(node) {
			if (node.children) return { action: cookText(node.action, settings.units), children: node.children.map(branch) };
			const index = row++;
			return { row: index, cell: grid.rows[index].cells.find((cell) => cell.kind === "ingredient") };
		}
		return branch(recipe.flow.root);
	});

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

{#snippet ingredient(cell)}
	<span><strong>{cell.text === "to taste" && /\bto taste\b/iu.test(cell.name) ? "" : cell.text}</strong> <span class="ingredient-name">{cell.name}</span>{#if ingredientIcon(cell.name)}
		<span class="ingredient-icon" aria-hidden="true">{ingredientIcon(cell.name)}</span>{/if}<small>{cookingNotes(cell.state).replace("Use the proportional split described in the method.", "Use the amount shown for this branch.")}</small></span>
{/snippet}

{#snippet mobileBranch(node)}
	{#if node.children}
		<div class="mobile-branch">
			<ul class="branch-inputs">{#each node.children as child, index (index)}<li>{@render mobileBranch(child)}</li>{/each}</ul>
			<div class="branch-join"><span aria-hidden="true">↓</span><p>{node.action}</p></div>
		</div>
	{:else}
		<div class="mobile-ingredient" class:checked={checks.includes(node.row)}>
			<!-- biome-ignore lint/a11y/noLabelWithoutControl: Installed Checkbox supplies the control. -->
			<label class="recipe-enhanced" for={`${uid}-mobile-${node.row}`}><Checkbox id={`${uid}-mobile-${node.row}`} checked={checks.includes(node.row)} disabled={!interactive} onCheckedChange={() => toggle(node.row)} />{@render ingredient(node.cell)}</label>
			<noscript><!-- biome-ignore lint/a11y/noLabelWithoutControl: The ingredient snippet supplies label text. --><label for={`${uid}-mobile-native-${node.row}`}><input id={`${uid}-mobile-native-${node.row}`} type="checkbox" />{@render ingredient(node.cell)}</label></noscript>
		</div>
	{/if}
{/snippet}

<section class="trn-view">
	<div class="flow-toolbar"><svelte:element this={`h${headingLevel}`} id={headingId} class="flow-heading">{recipe.type === "smoothie" ? "Preparation flow" : "Cooking flow"}</svelte:element></div>
	<p class="trn-help" id={helpId}><span class="desktop-help">Read left to right. Each merged cell acts on the ingredient rows feeding into it. Parallel branches stay separate until plating.</span><span class="mobile-help">Read top to bottom. Ingredients feed into the action below their branch. Follow each branch until it joins the next action.</span></p>
	{#if !printOnly}<section class="mobile-flow" aria-labelledby={headingId}>
		<div class="mobile-prep" hidden={preparation.length === 0}>{#each preparation as text, i (i)}<p>{text}</p>{/each}</div>
		<Button variant="ghost" class="reset-checks recipe-enhanced" disabled={!interactive} onclick={() => (checks = [])}>Reset cooking checks</Button>
		{@render mobileBranch(mobileFlow)}
	</section>{/if}
	<div class="trn-frame">
		<!-- Keyboard focus lets a keyboard user scroll the wide table sideways. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be reachable by keyboard to scroll it -->
		<section class="trn-scroll" tabindex="0" aria-labelledby={headingId} aria-describedby={helpId}>
			<table class="trn-table">
				<tbody>
					{#each preparation as text, i (i)}<tr><td colspan={grid.columns} class="trn-prep">{text}</td></tr>{/each}
					{#if !printOnly}<tr class="reset-checks-row recipe-enhanced"><td colspan={grid.columns}><Button variant="ghost" class="reset-checks" type="button" disabled={!interactive} onclick={() => (checks = [])}>Reset cooking checks</Button></td></tr>{/if}
					{#each grid.rows as row, i (i)}
						<tr>
							{#each row.cells as cell (cell.col)}
								{#if cell.kind === "ingredient"}
									<th scope="row" colspan={cell.colspan} class="trn-ingredient" class:checked={checks.includes(i)}>
									{#if printOnly}
										<div class="ingredient-label"><span class="paper-check" aria-hidden="true"></span>{@render ingredient(cell)}</div>
									{:else}
									<!-- biome-ignore lint/a11y/noLabelWithoutControl: The ingredient snippet supplies the label text. -->
									<label class="recipe-enhanced" for={`${uid}-${i}`}><span class="paper-check" aria-hidden="true"></span><Checkbox id={`${uid}-${i}`} checked={checks.includes(i)} disabled={!interactive} onCheckedChange={() => toggle(i)} />{@render ingredient(cell)}</label>
									<noscript>
										<!-- biome-ignore lint/a11y/noLabelWithoutControl: The ingredient snippet supplies the label text. -->
										<label for={`${uid}-${i}-native`}><input id={`${uid}-${i}-native`} type="checkbox" />{@render ingredient(cell)}</label>
									</noscript>
									{/if}
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
	{#if !printOnly}
		<Button variant="ghost" class="learn-method recipe-enhanced" type="button" disabled={!interactive} onclick={() => (methodOpen = true)}>Learn more about Tabular Recipe Notation</Button>
		<DialogRoot bind:open={methodOpen}>
			<DialogContent bind:ref={methodContent} class="method-dialog" tabindex={-1} showCloseButton={false} onOpenAutoFocus={focusMethodDialog}>
				<DialogTitle>Tabular Recipe Notation</DialogTitle>
				<DialogDescription class="visually-hidden">How to read a cooking dependency table.</DialogDescription>
				<p><span class="desktop-help">This format connects ingredients to cooking steps in a table. Read from left to right: each ingredient row feeds into the operation beside it. A merged operation cell uses all the ingredient rows alongside it.</span><span class="mobile-help">Read each branch from top to bottom. Add its ingredients, then follow the action below them. Nested branches join at the action beneath their shared border.</span></p>
				<p>Follow each branch across the table. Separate branches let you prepare parts of the meal independently; they join when those parts are combined or plated. Preparation notes at the top apply before you start.</p>
				<p>The table shows which ingredients each step uses. Preparation notes at the top list the equipment and steps to complete first. Tick each ingredient row as you add that portion; split ingredients have separate checks.</p>
				<p>The format comes from Michael Chu’s <a href="https://www.cookingforengineers.com/">Cooking for Engineers <span aria-hidden="true">↗</span></a>.</p>
				<Button variant="outline" onclick={() => (methodOpen = false)}>Close and continue recipe</Button>
			</DialogContent>
		</DialogRoot>
	<noscript>
		<a class="learn-method" href="https://www.cookingforengineers.com/">Learn more about Tabular Recipe Notation <span aria-hidden="true">↗</span></a>
	</noscript>
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
			color: var(--recipe-accent);
			text-decoration: underline;
			padding: 8px 0;
			margin-bottom: 12px;
			cursor: pointer;
			font: inherit;
			white-space: normal;
			max-width: 100%;
			min-width: 0;
			height: auto;
			min-height: 44px;
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
		.trn-ingredient label,
		.ingredient-label {
			display: flex;
			align-items: flex-start;
			gap: 8px;
			font-weight: 400;
		}
		.paper-check {
			display: none;
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
		/* A ticked row is muted ink (at least 4.5:1), not faded. */
		.trn-ingredient.checked span {
			color: var(--recipe-muted);
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
			border: 1px solid var(--recipe-line);
			background: transparent;
			color: var(--recipe-ink);
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
			border: 1px solid var(--recipe-line);
			border-radius: 6px;
			overflow: hidden;
			background: var(--recipe-flow-paper);
		}
		.trn-view :global(.trn-scroll) {
			overflow-x: auto;
			max-width: 100%;
		}
		.trn-frame:has(.trn-scroll:focus-visible) {
			outline: 3px solid var(--recipe-accent);
			outline-offset: 3px;
		}
		.trn-view :global(.trn-scroll:focus-visible) {
			outline: none;
		}
		.trn-view :global(.trn-table) {
			border-collapse: collapse;
			border: 1px solid var(--recipe-line);
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
		.trn-view :global(th),
		.trn-view :global(td) {
			border: 1px solid var(--recipe-line);
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
		.mobile-flow, .mobile-help { display: none; }
		@media screen and (max-width: 760px) {
			.trn-frame, .desktop-help { display: none; }
			.mobile-help { display: inline; }
			.mobile-flow { display: block; }
			.mobile-prep { padding: 12px; background: var(--recipe-flow-prep); border-radius: 10px; font-size: 0.85rem; }
			.mobile-prep p { margin: 0; }
			.mobile-prep :where(p + p) { margin-top: 8px; }
			.mobile-branch { border: 1px solid var(--recipe-line); border-radius: 10px; overflow: hidden; margin-top: 8px; }
			.branch-inputs { list-style: none; padding: 8px; margin: 0; display: grid; gap: 8px; }
			.branch-inputs > li { margin: 0; min-width: 0; }
			.branch-join { display: flex; align-items: flex-start; gap: 10px; border-top: 1px solid var(--recipe-line); padding: 12px; background: var(--recipe-soft); font-size: 0.9rem; font-weight: 600; }
			.branch-join p { margin: 0; }
			.mobile-ingredient { padding: 6px 2px; font-size: 0.9rem; overflow-wrap: anywhere; }
			.mobile-ingredient label { display: flex; align-items: flex-start; gap: 8px; }
			.mobile-ingredient small { display: block; font-size: 0.75rem; line-height: 1.4; margin-top: 3px; color: var(--recipe-muted); }
			.mobile-ingredient :global([data-slot="checkbox"]), .mobile-ingredient input { flex-shrink: 0; width: 20px; height: 20px; margin-top: 2px; }
			.mobile-ingredient.checked span { color: var(--recipe-muted); text-decoration: line-through; }
		}
		@media print {
			.paper-check {
				display: inline-block;
				width: 9pt;
				height: 9pt;
				flex-shrink: 0;
				border: 1px solid #000;
			}
			.reset-checks-row,
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
		}
	}
</style>
