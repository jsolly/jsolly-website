<script>
	// Keep the trigger mounted while loading its panel. The caller's autofocus
	// policy still decides whether focus may enter when the import completes.
	let { open, ref = $bindable(null), ...props } = $props();
	let Content = $state.raw(null);
	let failure = $state(false);
	let pending;
	$effect(() => {
		if (!open || Content || pending) return;
		failure = false;
		pending = import("../../lib/components/ui/popover-content.svelte")
			.then((module) => { Content = module.default; })
			.catch(() => { failure = true; })
			.finally(() => { pending = null; });
	});
</script>

{#if Content}<Content bind:ref {...props} />{:else if open && failure}<p role="status">This panel could not load. Close it and try again.</p>{/if}
