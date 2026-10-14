<script>
	import PopoverRoot from "../../lib/components/ui/popover.svelte";
	import PopoverContent from "../../lib/components/ui/popover-content.svelte";
	import PopoverTrigger from "../../lib/components/ui/popover-trigger.svelte";
	import { nutritionThresholds } from "./constants.mjs";

	// The nutrition filters' thresholds. A mouse opens it by hovering (bits-ui
	// leaves touch to the tap); a click, tap or Enter toggles it. It renders
	// right after the trigger, which it describes; it holds no controls, so
	// focus stays on the trigger and Tab moves on. Closing it moves focus only
	// out of the help itself (a click can focus it), back to the trigger;
	// focus anywhere else stays where it is.
	let { topic = "filters" } = $props();
	const OPEN_DELAY_MS = 100;
	const CLOSE_DELAY_MS = 120;
	const uid = $props.id();
	const contentId = `${uid}-content`;
	let trigger = $state(null);
	let content = $state(null);

	// bits-ui's own restore goes to whatever had focus when the content's focus
	// scope last mounted: the trigger only for a keyboard open (an earlier
	// control or the body after a hover open). bits-ui (2.19.5) also remounts
	// that scope once, a few milliseconds after it opens, and runs this then;
	// moving focus there would pull a quick Tab back to the trigger. So the
	// restore is always this one.
	function restoreFocus(event) {
		event.preventDefault();
		if (content?.contains(document.activeElement)) trigger?.focus();
	}
</script>

<PopoverRoot
	><PopoverTrigger bind:ref={trigger} class={topic === "net-carbs" ? "nutrition-info recipe-enhanced" : "nutrition-info"} aria-label={topic === "net-carbs" ? "What are net carbs?" : "About nutrition filters"} aria-describedby={contentId} openOnHover openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>ⓘ</PopoverTrigger
	><PopoverContent bind:ref={content} id={contentId} class="nutrition-help" portalProps={{ disabled: true }} sideOffset={4} trapFocus={false} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={restoreFocus}
		>{#if topic === "net-carbs"}<strong>Net carbs</strong><p>Total carbohydrates minus fiber. For example, 12 g of total carbs minus 4 g of fiber gives 8 g of net carbs.</p>{:else}<strong>Nutrition filters</strong>
		<p><strong>Iron-rich:</strong> {nutritionThresholds.ironRich}</p>
		<p><strong>Immune support:</strong> {nutritionThresholds.immuneSupport}</p>
		<p><strong>Omega-3s:</strong> {nutritionThresholds.omega3}</p>{/if}</PopoverContent
	></PopoverRoot
>

{#if topic === "net-carbs"}<noscript><small>Total carbohydrates minus fiber.</small></noscript>{/if}

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		/* Its 32px height is the library controls' (LibraryControls .nutrient-filters),
		   which outranks this rule's for its own 44px button height. */
		:global(.nutrition-info) {
			background: transparent;
			color: var(--recipe-accent);
			border: 0;
			padding: 4px 8px;
			cursor: pointer;
		}
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
		/* The attribute outranks the library's paragraph margins. */
		:global([data-slot="popover-content"].nutrition-help) p {
			margin: 8px 0 0;
		}
	}
</style>
