<script lang="ts">
 import { onMount } from 'svelte';
 import { siteLinks } from '../content/constants.js';
 import Button from '../lib/components/ui/button.svelte';

 let open = $state(false);
 let hydrated = $state(false);
 let toggle: HTMLButtonElement | HTMLAnchorElement | null = $state(null);
 onMount(() => { hydrated = true; });
 function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && open) { open = false; toggle?.focus(); }
 }
</script>

<svelte:window onkeydown={closeOnEscape} />
<header id="site-header" class="flex justify-between items-center py-6 md:py-8">
 <a href="/" class="text-2xl font-bold font-heading text-primary-700 hover:text-primary-600 transition-colors" aria-label="Home">Home</a>
 <nav class="hidden md:flex items-center space-x-8" aria-label="Primary navigation">
  {#each siteLinks as link (link.href)}
   <a href={link.href} target={link.target} rel={link.rel} class="text-lg font-medium text-text-secondary hover:text-primary-600 transition-colors" aria-label={link.label}>{link.text}</a>
  {/each}
 </nav>
 <Button bind:ref={toggle} variant="ghost" size="icon" id="mobile-menu-button" class="md:hidden size-11 rounded-md text-text-primary cursor-pointer" aria-label="Toggle mobile menu" aria-expanded={open} aria-controls="mobile-menu" disabled={!hydrated} onclick={() => { open = !open; }}>
  <svg class="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" /></svg>
 </Button>
</header>
<nav id="mobile-menu" class={['md:hidden', !open && 'hidden']} aria-label="Mobile navigation">
 <div class="flex flex-col space-y-4 px-2 pt-2 pb-3">
  {#each siteLinks as link (link.href)}
   <a href={link.href} target={link.target} rel={link.rel} class="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-primary-600 hover:bg-primary-100" aria-label={link.label}>{link.text}</a>
  {/each}
 </div>
</nav>
