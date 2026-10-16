<script>
	import Button from "../../lib/components/ui/button.svelte";
	import DialogRoot from "../../lib/components/ui/dialog.svelte";
	import DialogContent from "../../lib/components/ui/dialog-content.svelte";
	import DialogDescription from "../../lib/components/ui/dialog-description.svelte";
	import DialogTitle from "../../lib/components/ui/dialog-title.svelte";
	import RecipeContent from "./RecipeContent.svelte";
	import RecipePrintButton from "./RecipePrintButton.svelte";
	import ShareRecipe from "./ShareRecipe.svelte";
	import UnitControl from "./UnitControl.svelte";

	// The library's full-screen recipe dialog. Its section id is the recipe id,
	// so an old /recipes/#<id> link lands on it. Closing it (Escape or Back to
	// recipes) calls onBack; focus starts on the title.
	let {
		recipe,
		settings,
		onBack,
		onPrint,
		onSideChange,
		onUnitsChange,
		heading = $bindable(null),
		dialog = $bindable(null),
	} = $props();
</script>

<DialogRoot
	open
	onOpenChange={(open) => {
		if (!open) onBack();
	}}
	><DialogContent
		class="recipe-takeover"
		bind:ref={dialog}
		showCloseButton={false}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			heading?.focus({ preventScroll: true });
		}}
		onCloseAutoFocus={(event) => event.preventDefault()}
		><section class="recipe-detail" id={recipe.id} aria-labelledby="recipe-detail-title">
			<div class="detail-toolbar">
				<Button variant="ghost" type="button" class="text-button" onclick={() => onBack()}>← Back to recipes</Button>
				<RecipePrintButton {recipe} {settings} class="print-recipe" {onPrint} />
			</div>
			<DialogDescription class="visually-hidden">{recipe.summary}</DialogDescription>
			<RecipeContent {recipe} {settings} headingLevel={3} {onSideChange}>
				{#snippet title()}<DialogTitle id="recipe-detail-title" tabindex={-1} bind:ref={heading}>{recipe.title}</DialogTitle>{/snippet}
				{#snippet controls()}<UnitControl recipeId={recipe.id} units={settings.units} {onUnitsChange} />{/snippet}
			</RecipeContent>
			<ShareRecipe {recipe} {settings} />
		</section></DialogContent
	></DialogRoot
>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		/* bits-ui portals the dialog to <body>, outside the library. It takes
		   the whole viewport without the dialog's open and close animation. */
		:global(.recipe-takeover) {
			font: 16px/1.4 var(--font-body);
			position: fixed;
			inset: 0;
			/* Undoes dialog-content's -translate-1/2 centring. Alone: next to
			   transform: none, the CSS minifier folds the pair into a transform
			   and drops this. */
			translate: none;
			animation: none;
			display: block;
			box-shadow: none;
			border-radius: 0;
			width: 100%;
			height: 100dvh;
			max-width: none;
			max-height: none;
			margin: 0;
			border: 0;
			padding: 24px;
			background: var(--recipe-canvas);
			color: var(--recipe-ink);
			overflow: auto;
			overscroll-behavior: contain;
		}
		.recipe-detail {
			max-width: 1100px;
			margin: 0 auto;
			padding: 28px;
			background: var(--recipe-paper);
			border: 1px solid var(--recipe-line);
			border-radius: 20px;
			scroll-margin-top: 20px;
		}
		.detail-toolbar {
			display: flex;
			justify-content: space-between;
			gap: 14px;
			margin-bottom: 16px;
		}
		.detail-toolbar :global(.text-button) {
			border: 0;
			background: transparent;
			color: var(--recipe-accent);
			padding: 8px 3px;
			font-size: 0.85rem;
		}
		.recipe-detail :global(h2) {
			font: 600 clamp(2rem, 4vw, 3rem) / 1.13 var(--font-heading);
			max-width: 800px;
			margin: 14px 0 10px;
		}
		@media (max-width: 600px) {
			:global(.recipe-takeover) {
				padding: 12px;
			}
			.recipe-detail {
				padding: 18px;
				border-radius: 14px;
			}
			.detail-toolbar {
				flex-direction: column;
				margin-bottom: 18px;
				gap: 5px;
			}
		}
		@media print {
			:global(.recipe-takeover) {
				display: none;
			}
		}
	}
</style>
