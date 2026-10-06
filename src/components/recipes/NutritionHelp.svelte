<script>
	import PopoverRoot from "../../lib/components/ui/popover.svelte";
	import PopoverContent from "../../lib/components/ui/popover-content.svelte";
	import PopoverTrigger from "../../lib/components/ui/popover-trigger.svelte";

	// The nutrition filters' thresholds. A mouse opens it by hovering (bits-ui
	// leaves touch to the tap); a click, tap or Enter toggles it. It holds no
	// controls, so focus stays on the trigger, Tab moves on, and closing it
	// from the keyboard returns focus to the trigger.
	const OPEN_DELAY_MS = 100;
	const CLOSE_DELAY_MS = 120;
	const uid = $props.id();
	const titleId = `${uid}-title`;
</script>

<PopoverRoot
	><PopoverTrigger class="nutrition-info" aria-label="About nutrition filters" openOnHover openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>ⓘ</PopoverTrigger
	><PopoverContent class="nutrition-help" role="dialog" aria-labelledby={titleId} sideOffset={4} trapFocus={false} onOpenAutoFocus={(event) => event.preventDefault()}
		><strong id={titleId}>Nutrition filters</strong>
		<p><strong>Iron-rich:</strong> at least 20% Daily Value of iron per serving.</p>
		<p><strong>Immune support:</strong> at least 20% Daily Value in two or more of vitamins A, C, D, zinc and selenium per serving.</p>
		<p>
			<strong>Omega-3s:</strong> at least 0.5 g of recorded ALA, EPA, and DHA per meal serving or 8 oz smoothie glass. Missing nutrient observations are excluded. This is a recipe filter threshold, not a Daily Value.
		</p></PopoverContent
	></PopoverRoot
>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		/* Its 32px height is the library's (RecipeLibrary .nutrient-filters),
		   which outranks this rule's for its own 44px button height. */
		:global(.nutrition-info) {
			background: transparent;
			color: var(--recipe-accent);
			border: 0;
			padding: 4px 8px;
			cursor: pointer;
		}
		/* The popover portals to <body>, outside the library. */
		:global(.nutrition-help) {
			z-index: 60;
			width: 320px;
			max-width: calc(100vw - 32px);
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			border: 1px solid var(--recipe-line);
			border-radius: 8px;
			padding: 12px;
			font: 13px/1.5 var(--font-body);
			box-shadow: 0 4px 16px #0003;
		}
		:global(.nutrition-help p) {
			margin: 8px 0 0;
		}
	}
</style>
