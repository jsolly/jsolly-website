<script>
	import Button from "../../lib/components/ui/button.svelte";
	import Checkbox from "../../lib/components/ui/checkbox.svelte";
	import PopoverRoot from "../../lib/components/ui/popover.svelte";
	import PopoverContent from "../../lib/components/ui/popover-content.svelte";
	import PopoverTrigger from "../../lib/components/ui/popover-trigger.svelte";
	import { choiceUnavailable } from "./nutrient-filters.mjs";

	// One of the library's multi-choice filters: a trigger summarising the
	// choices and a popover of checks. An unchecked choice that would leave no
	// recipe (canSelect says no) is disabled; a checked one can always go.
	let {
		label,
		options,
		selected = $bindable([]),
		emptyLabel,
		disabled = false,
		canSelect = () => true,
	} = $props();
	const uid = $props.id();
	let open = $state(false);
	let trigger = $state(null);
	let content = $state(null);
	const summary = $derived(
		selected.length
			? selected.map((value) => options[value]).join(", ")
			: emptyLabel,
	);

	function toggled(value) {
		return selected.includes(value)
			? selected.filter((item) => item !== value)
			: [...selected, value];
	}

	// Focus immediately on opening. A queued animation-frame autofocus can
	// otherwise pull focus back after the user has already tabbed away.
	function enterFocus(event) {
		event.preventDefault();
		if (document.activeElement !== trigger) return;
		// biome-ignore lint/security/noSecrets: CSS selector, not a credential.
		content?.querySelector('button:not([disabled])')?.focus();
	}

	// Return keyboard focus from the panel, but keep an outside control's
	// focus when the user clicks it to dismiss the filter.
	function restoreFocus(event) {
		event.preventDefault();
		if (open) return;
		if (content?.contains(document.activeElement)) trigger?.focus();
	}
</script>

<div class="filter-select">
	<span class="filter-label">{label}</span>
	<PopoverRoot bind:open>
		<PopoverTrigger bind:ref={trigger} class="multi-trigger" aria-label={`${label}: ${summary}`} {disabled}>
			<span>{summary}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4" /></svg>
		</PopoverTrigger>
		<PopoverContent bind:ref={content} trapFocus={false} onOpenAutoFocus={enterFocus} onCloseAutoFocus={restoreFocus} class="multi-options" portalProps={{ disabled: true }} sideOffset={6} collisionPadding={16} role="dialog" aria-label={`${label} choices`}>
			{#each Object.entries(options) as [value, text] (value)}
				<label for={`${uid}-${value}`}
					><Checkbox
						id={`${uid}-${value}`}
						checked={selected.includes(value)}
						disabled={choiceUnavailable(selected.includes(value), () => canSelect(toggled(value)))}
						onCheckedChange={() => {
							selected = toggled(value);
						}}
					/>{text}</label
				>
			{/each}
			<Button
				variant="outline"
				type="button"
				onclick={() => {
					selected = [];
				}}>Clear selections</Button
			>
		</PopoverContent>
	</PopoverRoot>
</div>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.filter-label {
			font-size: 0.86rem;
			font-weight: 600;
			display: block;
			margin-bottom: 6px;
		}
		/* The attribute outranks the library's `button { font: inherit }`, which
		   still sets the trigger's weight and family (as in SRC). */
		.filter-select :global([data-slot="popover-trigger"].multi-trigger) {
			display: flex;
			width: 100%;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 44px;
			text-align: left;
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			border: 1px solid var(--recipe-muted);
			border-radius: 8px;
			padding: 10px;
			font-size: 0.86rem;
		}
		.filter-select :global(.multi-trigger span) {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		svg {
			flex-shrink: 0;
			margin-right: 4px;
		}
		.filter-select :global(.multi-options) {
			z-index: 50;
			background: var(--recipe-paper);
			color: var(--recipe-ink);
			border: 1px solid var(--recipe-input-border);
			border-radius: 10px;
			padding: 10px;
			width: var(--bits-popover-anchor-width);
			max-width: calc(100vw - 32px);
			max-height: min(var(--bits-popover-content-available-height), calc(100dvh - 32px));
			overflow-y: auto;
			box-shadow: 0 8px 24px #0002;
		}
		label {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 44px;
			padding: 4px 8px;
			font-size: 0.86rem;
			font-weight: 500;
			cursor: pointer;
		}
		.filter-select :global(.multi-options [data-slot="button"]) {
			width: 100%;
			background: transparent;
			color: inherit;
			border: 1px solid var(--recipe-input-border);
			border-radius: 6px;
			min-height: 44px;
		}
	}
</style>
