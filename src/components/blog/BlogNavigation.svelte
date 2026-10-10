<script lang="ts">
  import { onMount } from "svelte";
  import { categoryHref } from "../../lib/blog/urls.js";
  import Button from "../../lib/components/ui/button.svelte";
  import Collapsible from "../../lib/components/ui/collapsible.svelte";
  import CollapsibleContent from "../../lib/components/ui/collapsible-content.svelte";
  import CollapsibleTrigger from "../../lib/components/ui/collapsible-trigger.svelte";
  import Input from "../../lib/components/ui/input.svelte";

  let { categories, pathname }: {
    categories: { slug: string; name: string; count: number }[];
    pathname: string;
  } = $props();
  // Keep first paint and hydration closed. forceMount keeps the links in the
  // server render; the no-script stylesheet expands them without JavaScript.
  let open = $state(false);
  let hydrated = $state(false);
  onMount(() => { hydrated = true; });
</script>

<nav class="blog-toolbar" aria-label="Blog navigation">
  <div class="blog-toolbar-links">
    <a href="/blog/" aria-current={pathname === "/blog/" ? "page" : undefined}>Blog home</a>
    <a href="/blog/all-posts/">All posts</a>
    <Collapsible bind:open class="category-menu">
      <CollapsibleTrigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline" disabled={!hydrated} class="category-toggle">Categories</Button>
        {/snippet}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount class="category-options">
        {#each categories as category (category.slug)}
          <a href={categoryHref(category.slug)} aria-current={pathname === categoryHref(category.slug) ? "page" : undefined}>
            {category.name} <span>{category.count}<span class="visually-hidden"> posts</span></span>
          </a>
        {/each}
      </CollapsibleContent>
    </Collapsible>
  </div>
  <search aria-label="Blog search">
    <form action="/blog/search/" method="get" class="search-form">
      <label class="visually-hidden" for="site-search">Search posts</label>
      <Input id="site-search" type="search" name="searched" placeholder="Search posts..." />
      <Button type="submit">Search</Button>
    </form>
  </search>
</nav>
