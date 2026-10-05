<script lang="ts">
	import { onMount, tick } from "svelte";
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
	// The query the status line describes, trailing `query` while typing.
	let announced = $state("");
	let mounted = $state(false);
	let status = $state<HTMLDivElement>();
	type SearchState =
		| { kind: "loading" }
		| { kind: "error" }
		| { kind: "ready"; search: ReturnType<typeof createArticleSearch> };
	let searchState = $state<SearchState>({ kind: "loading" });
	const results = $derived(searchState.kind === "ready" ? searchState.search(query) : []);
	const resultCards = $derived(
		results.flatMap((result) => {
			const card = cardsBySlug.get(result.slug);
			return card ? [card] : [];
		}),
	);
	const announcedCount = $derived(
		searchState.kind === "ready" ? searchState.search(announced).length : 0,
	);

	$effect(() => {
		const next = query;
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

	// Try again unmounts itself, so focus moves to the status line once the
	// retry has settled instead of falling to the page.
	async function retry() {
		await loadIndex();
		await tick();
		status?.focus();
	}

	onMount(() => {
		submitted = new URLSearchParams(window.location.search).get("searched") ?? "";
		query = submitted;
		announced = submitted;
		mounted = true;
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
<div role="status" tabindex="-1" aria-busy={mounted && searchState.kind === "loading" ? "true" : undefined} bind:this={status}>
	{#if searchState.kind === "loading"}<p class="search-loading">Loading search...</p>
	{:else if searchState.kind === "error"}<p>Search couldn't load. <Button onclick={retry}>Try again</Button> or <a href="/blog/all-posts/">browse all posts</a>.</p>
	{:else if announced.trim()}<p>{announcedCount} {announcedCount === 1 ? "result" : "results"}</p>
	{:else}<p>Search titles and article text. Partial words and small typos work too.</p>{/if}
</div>
{#if searchState.kind === "ready" && query.trim()}
	{#if !results.length}<p>No articles matched. Try a shorter phrase or another topic.</p>{/if}
	<PostCards posts={resultCards} />
{/if}
<noscript><p>Search requires JavaScript. <a href="/blog/all-posts/">Browse all posts</a>.</p></noscript>
