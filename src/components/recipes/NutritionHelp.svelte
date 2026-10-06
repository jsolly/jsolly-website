<script>
	import { onDestroy } from "svelte";
	import PopoverRoot from "../../lib/components/ui/popover.svelte";
	import PopoverContent from "../../lib/components/ui/popover-content.svelte";
	import PopoverTrigger from "../../lib/components/ui/popover-trigger.svelte";

	// The nutrition filters' thresholds. A mouse on a hover-capable device
	// opens it by hovering (with a short grace period to reach the popover);
	// a tap, click or Enter toggles it.
	const CLOSE_DELAY_MS = 120;
	let open = $state(false);
	let timer;

	function enter(event) {
		if (
			event.pointerType === "mouse" &&
			matchMedia("(hover: hover) and (pointer: fine)").matches
		) {
			clearTimeout(timer);
			open = true;
		}
	}

	function leave(event) {
		if (event.pointerType === "mouse") {
			clearTimeout(timer);
			timer = setTimeout(() => {
				open = false;
			}, CLOSE_DELAY_MS);
		}
	}

	onDestroy(() => clearTimeout(timer));
</script>

<PopoverRoot bind:open
	><PopoverTrigger class="nutrition-info" aria-label="About nutrition filters" onpointerenter={enter} onpointerleave={leave}>ⓘ</PopoverTrigger
	><PopoverContent
		class="nutrition-help"
		sideOffset={4}
		onpointerenter={enter}
		onpointerleave={leave}
		onOpenAutoFocus={(event) => event.preventDefault()}
		onCloseAutoFocus={(event) => event.preventDefault()}
		><strong>Nutrition filters</strong>
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
