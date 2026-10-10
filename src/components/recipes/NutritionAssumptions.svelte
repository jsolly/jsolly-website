<script>
	import Button from "../../lib/components/ui/button.svelte";
	import Collapsible from "../../lib/components/ui/collapsible.svelte";
	import CollapsibleContent from "../../lib/components/ui/collapsible-content.svelte";
	import CollapsibleTrigger from "../../lib/components/ui/collapsible-trigger.svelte";

	let { assumptions, interactive = true } = $props();
</script>

{#snippet notes()}
	<ul class="nutrition-assumptions-list">
		{#each assumptions as assumption (assumption)}<li>{assumption}</li>{/each}
	</ul>
{/snippet}

{#if interactive}
	<Collapsible class="nutrition-assumptions">
		<CollapsibleTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" class="assumptions-trigger">Nutrition assumptions</Button>
			{/snippet}
		</CollapsibleTrigger>
		<CollapsibleContent>{@render notes()}</CollapsibleContent>
	</Collapsible>
{:else}
	<details class="nutrition-assumptions">
		<summary>Nutrition assumptions</summary>
		{@render notes()}
	</details>
{/if}

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		:global(.nutrition-assumptions) {
			margin-top: 16px;
		}
		:global(.assumptions-trigger) {
			white-space: normal;
		}
		summary {
			cursor: pointer;
			font-weight: 650;
		}
		.nutrition-assumptions-list {
			font-size: 0.85rem;
			overflow-wrap: anywhere;
		}
	}
</style>
