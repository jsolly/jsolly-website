<script lang="ts">
	import XIcon from "@lucide/svelte/icons/x";
	import { Dialog as DialogPrimitive } from "bits-ui";
	import type { ComponentProps, Snippet } from "svelte";
	import type { WithoutChildrenOrChild } from "../../ui-types.js";
	import { cn } from "../../utils.js";
	import Button from "./button.svelte";
	import DialogOverlay from "./dialog-overlay.svelte";
	import DialogPortal from "./dialog-portal.svelte";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
		showCloseButton?: boolean;
	} = $props();
</script>

<DialogPortal {...portalProps}>
	<DialogOverlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 ui-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full max-w-(--dialog-max-width) -translate-1/2 gap-4 rounded-xl p-4 text-sm ring-1 duration-100 outline-none sm:max-w-sm",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<DialogPrimitive.Close data-slot="dialog-close">
				{#snippet child({ props })}
					<Button variant="ghost" class="absolute top-2 right-2" size="icon-sm" {...props}>
						<XIcon  />
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPortal>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer components {
		:global(.ui-dialog-content) { --dialog-max-width: calc(100% - 2rem); }
	}
</style>
