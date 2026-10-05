<script lang="ts">
	import { onMount } from "svelte";
	import { categoryHref } from "../../lib/blog/urls.js";
	import Button from "../../lib/components/ui/button.svelte";
	import Input from "../../lib/components/ui/input.svelte";

	let {
		categories,
		pathname,
	}: {
		categories: { slug: string; name: string; count: number }[];
		pathname: string;
	} = $props();
	let open = $state(false);
	let hydrated = $state(false);
	let mobile = $state(false);
	onMount(() => {
		// Must match the max-width: 900px breakpoint in styles/blog/blog.css and
		// styles/blog/no-script.css, where the panel collapses behind the toggle.
		const query = window.matchMedia("(max-width: 900px)");
		const update = () => {
			mobile = query.matches;
		};
		update();
		query.addEventListener("change", update);
		hydrated = true;
		return () => query.removeEventListener("change", update);
	});
</script>

<Button class="menu-toggle" aria-expanded={open} aria-controls="mobile-navigation" onclick={() => { open = !open; }} disabled={!hydrated} aria-label="Menu">
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
		<path class="menu-line top" d="M3 6h18" />
		<path class="menu-line middle" d="M3 12h18" />
		<path class="menu-line bottom" d="M3 18h18" />
	</svg>
</Button>
<div id="mobile-navigation" class="navigation-panel" class:collapsed={!open} inert={mobile && !open}>
<nav aria-label="Main navigation">
	<a href="/blog/all-posts/">All posts</a>
	<a href="/blog/rss.xml">RSS</a>
	<a href="https://github.com/jsolly">GitHub</a>
	<details class="category-menu">
		<summary>Categories</summary>
		<div class="category-options">
			<a href="/blog/" aria-current={pathname === "/blog/" ? "page" : undefined}>Blog home</a>
		{#each categories as category (category.slug)}
			<a href={categoryHref(category.slug)} aria-current={pathname === categoryHref(category.slug) ? "page" : undefined}>{category.name} <span>{category.count}<span class="visually-hidden"> posts</span></span></a>
		{/each}
		</div>
	</details>
	<search class="search-form">
		<form action="/blog/search/" method="get" class="contents">
			<label class="visually-hidden" for="site-search">Search</label>
			<Input id="site-search" type="search" name="searched" placeholder="Search posts..." /><Button type="submit">Search</Button>
		</form>
	</search>
</nav>
</div>
