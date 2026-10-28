<script>
	// A line drawing of an appliance a recipe needs, labelled with its name
	// unless decorative.
	let { name, decorative = false } = $props();
</script>

<svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role={decorative ? undefined : "img"} aria-hidden={decorative} aria-label={decorative ? undefined : name}>
	<title>{name}</title>
	{#if name === "Oven"}
		<rect x="4" y="3" width="24" height="26" rx="3" /><path d="M4 10h24M9 7h.1M16 7h.1M23 7h.1" /><rect x="8" y="14" width="16" height="11" rx="1" /><path d="M12 17h8" />
	{:else if name === "Two air fryers" || name === "Air fryer"}
		<rect x="5" y="3" width="22" height="26" rx="5" /><path d="M12 8h8M7 14h18M14 18h4v6h-4z" />
	{:else if name === "Blender"}
		<path d="M9 3h14l-2 16H11zM12 19h8l4 10H8zM23 6h4v9h-5M12 9h4M12 13h4" /><circle cx="16" cy="25" r="1" />
  {:else if name === "Stovetop"}
    <rect x="3" y="5" width="26" height="22" rx="3"/><circle cx="10" cy="12" r="3"/><circle cx="22" cy="12" r="3"/><circle cx="10" cy="21" r="3"/><circle cx="22" cy="21" r="3"/>
  {:else if name === "Grill"}
    <path d="M4 12h24a12 12 0 0 1-24 0zM10 24l-3 5M22 24l3 5M7 7h18M10 3v4M16 3v4M22 3v4"/>
  {:else if name === "Waffle iron"}
    <rect x="4" y="5" width="24" height="22" rx="4"/><path d="M10 9v14M16 9v14M22 9v14M8 13h16M8 19h16M11 29h10"/>
  {:else if name === "Slow cooker"}
    <path d="M5 10h22v14a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM3 10h26M10 7h12M13 4h6v3M2 16h3M27 16h3"/><circle cx="16" cy="22" r="2"/>
	{:else if name === "Pans"}
		<path d="M3 15h17v3a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7zM20 17l10-4M8 7v4M13 5v6" />
	{:else if name === "Microwave"}
		<rect x="2" y="7" width="28" height="19" rx="3" /><rect x="6" y="11" width="15" height="11" rx="1" /><path d="M25 12h1M25 16h1M25 20h1M8 29h16" />
	{:else if name === "Large bowl" || name === "Small bowl"}
		{#if name === "Large bowl"}<path d="M3 11h26c-1 11-5 16-13 16S4 22 3 11z" /><ellipse cx="16" cy="11" rx="13" ry="3" />
		{:else}<path d="M7 15h18c-1 8-4 11-9 11S8 23 7 15z" /><ellipse cx="16" cy="15" rx="9" ry="2.5" />{/if}
	{:else if name === "Chopping board"}
		<rect x="4" y="6" width="24" height="23" rx="3" /><path d="M12 6V3h8v3M9 14l14 11M10 13l3-3 13 11-3 4z" />
	{:else if name === "Baking dish"}
		<path d="M6 8h20v17H6zM6 11H2v8h4M26 11h4v8h-4M9 12h14M9 16h14M9 20h14" />
	{:else if name === "Spiralizer"}
		<path d="M5 26h23M8 26V9h15v17M23 13h6v7M8 8V4M14 14c7-5 9 5 2 5s-5 8 3 4" />
	{:else if name === "Serving dishes"}
		<ellipse cx="16" cy="17" rx="13" ry="9" /><ellipse cx="16" cy="17" rx="8" ry="5" /><path d="M3 25h26" />
	{:else if name === "Sieve"}
		<path d="M5 12h20a10 10 0 0 1-20 0zM25 13l6-5M3 10h24M10 15v5M15 15v7M20 15v5" />
	{:else if name === "Kitchen utensils"}
		<path d="M8 3v9M4 3v6a4 4 0 0 0 8 0V3M8 13v16M23 14v15" /><ellipse cx="23" cy="8" rx="4" ry="6" />
	{:else}
		<path d="M7 11h18v13a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4zM5 11h22M10 7h12l3 4M13 4h6v3M3 15h4M25 15h4" /><rect x="12" y="17" width="8" height="6" rx="1" />
	{/if}
</svg>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		svg {
			display: block;
			flex-shrink: 0;
		}
	}
</style>
