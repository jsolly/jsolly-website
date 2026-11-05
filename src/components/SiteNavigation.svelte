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
<header id="site-header" class="flex items-center justify-between py-6 md:py-8">
 <a href="/" class="font-heading text-primary-700 hover:text-primary-600 text-2xl font-bold transition-colors" aria-label="Home">Home</a>
 <nav class="hidden items-center space-x-8 md:flex" aria-label="Primary navigation">
  {#each siteLinks as link (link.href)}
   <a href={link.href} target={link.target} rel={link.rel} class="text-text-secondary hover:text-primary-600 text-lg font-medium transition-colors" aria-label={link.label}>{link.text}</a>
  {/each}
 </nav>
 <Button bind:ref={toggle} variant="ghost" size="icon" id="mobile-menu-button" class="text-text-primary size-11 cursor-pointer rounded-md md:hidden" aria-label="Toggle mobile menu" aria-expanded={open} aria-controls="mobile-menu" disabled={!hydrated} onclick={() => { open = !open; }}>
  <svg class="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" /></svg>
 </Button>
</header>
<nav id="mobile-menu" class={['mobile-menu md:hidden', { 'is-open': open }]} inert={hydrated && !open} aria-label="Mobile navigation">
 <div class="mobile-menu-clip">
 <div class="flex flex-col space-y-4 px-2 pt-2 pb-3">
  {#each siteLinks as link (link.href)}
   <a href={link.href} target={link.target} rel={link.rel} class="text-text-secondary hover:text-primary-600 hover:bg-primary-100 block rounded-md px-3 py-2 text-base font-medium" aria-label={link.label}>{link.text}</a>
  {/each}
 </div>
</div>
</nav>
