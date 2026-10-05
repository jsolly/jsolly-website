<script lang="ts">
	import { onMount } from "svelte";
	import { createArticleSearch, parseSearchIndex } from "../../lib/blog/search.js";
	import type { Card } from "../../lib/blog/types.js";
	import Button from "../../lib/components/ui/button.svelte";
	import Input from "../../lib/components/ui/input.svelte";
	import PostCards from "./PostCards.svelte";

	// The published post cards; a search hit shows its post's card.
	let { posts }: { posts: Card[] } = $props();
	// How long typing must pause before the status line announces a new count.
	const ANNOUNCE_DELAY_MS = 400;
	const cardsBySlug = $derived(new Map(posts.map((post) => [post.slug, post])));
	// The query this page was opened with (?searched=), which the heading names.
	let submitted = $state("");
	// The search box, which filters the results as the reader types.
	let query = $state("");
	// The status line's result count (null: no query, so the hint), trailing
	// the cards while the reader types.
	let announced = $state<number | null>(null);
	let announcedOnce = false;
	let status = $state<HTMLDivElement>();
	// idle until mount, so the server render (and a page without JavaScript)
	// carries no loading line.
	type SearchState =
		| { kind: "idle" }
		| { kind: "loading" }
		| { kind: "error" }
		| { kind: "ready"; search: ReturnType<typeof createArticleSearch> };
	let searchState = $state<SearchState>({ kind: "idle" });
	const results = $derived(searchState.kind === "ready" ? searchState.search(query) : []);
	// The index and the cards cover the same published posts; a hit without a
	// card is a bug, not a result to drop.
	const resultCards = $derived(
		results.map((result) => {
			const card = cardsBySlug.get(result.slug);
			if (!card) throw new Error(`Search hit ${result.slug} has no post card`);
			return card;
		}),
	);

	// The first count after the index loads shows at once; later ones once
	// typing pauses.
	$effect(() => {
		if (searchState.kind !== "ready") return;
		const next = query.trim() ? results.length : null;
		if (!announcedOnce) {
			announcedOnce = true;
			announced = next;
			return;
		}
		const timer = setTimeout(() => {
			announced = next;
		}, ANNOUNCE_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function loadIndex() {
		searchState = { kind: "loading" };
		try {
			const response = await fetch("/blog/search-index.json");
			if (!response.ok) throw new Error(`Search index HTTP ${response.status}`);
			searchState = {
				kind: "ready",
				search: createArticleSearch(parseSearchIndex(await response.json())),
			};
		} catch (error) {
			console.error("Search index failed to load", error);
			searchState = { kind: "error" };
		}
	}

	// Try again unmounts itself, so focus moves to the status line first
	// instead of falling to the page.
	async function retry() {
		status?.focus();
		await loadIndex();
	}

	onMount(() => {
		submitted = new URLSearchParams(window.location.search).get("searched") ?? "";
		query = submitted;
		void loadIndex();
	});
</script>

<h1>{submitted ? `You searched for '${submitted}'` : "Search posts"}</h1>
<search aria-label="Search articles">
	<form action="/blog/search/" method="get" class="search-form search-page-form">
		<label for="article-search">Search articles</label>
		<div><Input id="article-search" type="search" name="searched" bind:value={query} placeholder="Title, topic or phrase" /><Button type="submit">Search</Button></div>
	</form>
</search>
<div role="status" tabindex="-1" aria-busy={searchState.kind === "loading" ? "true" : undefined} bind:this={status}>
	{#if searchState.kind === "loading"}<p>Loading search...</p>
	{:else if searchState.kind === "error"}<p>Search couldn't load. <Button onclick={retry}>Try again</Button> or <a href="/blog/all-posts/">browse all posts</a>.</p>
	{:else if searchState.kind === "ready" && announced !== null}<p>{announced} {announced === 1 ? "result" : "results"}</p>
	{:else if searchState.kind === "ready"}<p>Search titles and article text. Partial words and small typos work too.</p>{/if}
</div>
{#if searchState.kind === "ready" && query.trim()}
	{#if !results.length}<p>No articles matched. Try a shorter phrase or another topic.</p>{/if}
	<PostCards posts={resultCards} />
{/if}
<noscript><p>Search requires JavaScript. <a href="/blog/all-posts/">Browse all posts</a>.</p></noscript>
