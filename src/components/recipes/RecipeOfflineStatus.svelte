<script>
	import { onMount, untrack } from "svelte";
	import Button from "../../lib/components/ui/button.svelte";
	import { saveRecipeOffline } from "./recipe-offline.mjs";

	let { recipe } = $props();
	let enabled = $state(false);
	let saving = $state(false);
	let failed = $state(false);
	let status = $state("");
	let disposed = false;
	let generation = 0;
	async function save(id = recipe.id) {
		const own = ++generation;
		saving = true; failed = false; status = "Saving recipe for offline use…";
		try {
			await saveRecipeOffline(id);
			if (!disposed && own === generation) status = "Available offline";
		} catch {
			if (!disposed && own === generation) { failed = true; status = "This version could not be saved offline. Any previously saved version remains available."; }
		} finally { if (!disposed && own === generation) saving = false; }
	}
	onMount(() => {
		if (!("serviceWorker" in navigator) || !document.querySelector("#recipe-offline-status")) return;
		const controlled = () => { enabled = Boolean(navigator.serviceWorker.controller); };
		navigator.serviceWorker.addEventListener("controllerchange", controlled);
		controlled();
		return () => { disposed = true; navigator.serviceWorker.removeEventListener("controllerchange", controlled); };
	});
	$effect(() => { const id = recipe.id; if (enabled) untrack(() => { void save(id); }); });
</script>

{#if enabled}<div class="recipe-offline-feedback"><p role="status">{status}</p>{#if failed}<Button variant="outline" type="button" disabled={saving} onclick={() => save()}>Retry offline save</Button>{/if}</div>{/if}

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.recipe-offline-feedback { font-size: .85rem; color: var(--recipe-muted); }
		@media print { .recipe-offline-feedback { display: none; } }
	}
</style>
