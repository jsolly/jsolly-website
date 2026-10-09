<script lang="ts">
	import { onMount, tick } from "svelte";
	import { AUTOMATIC_BATCHES } from "../../lib/blog/constants.js";
	import type { Card } from "../../lib/blog/types.js";
	import Button from "../../lib/components/ui/button.svelte";

	// Without a pageSize every card renders and there is no load-more.
	// headingTag sets each card title's level under its section's heading
	// (a post page's "Related posts" h2 holds h3 cards).
	let {
		posts,
		pageSize = Number.POSITIVE_INFINITY,
		headingTag = "h2",
	}: { posts: Card[]; pageSize?: number; headingTag?: "h2" | "h3" } = $props();
	// How far below the viewport the load-more area starts loading, as the
	// observer's rootMargin.
	const REACH_PX = 200;
	let page = $state(1);
	const pages = $derived(Math.max(1, Math.ceil(posts.length / pageSize)));
	const visible = $derived(posts.slice(0, page * pageSize));
	let sentinel = $state<HTMLDivElement>();
	let automaticBatchesLeft = $state(AUTOMATIC_BATCHES);
	let postList = $state<HTMLDivElement>();

	// Shows the next batch and records it in ?page=, so a reload or Back
	// returns to the same list. Resolves once the new cards are in the DOM.
	async function advance() {
		page += 1;
		const url = new URL(window.location.href);
		url.searchParams.set("page", String(page));
		window.history.replaceState(null, "", url);
		await tick();
	}

	// Load more pressed: a fresh automatic budget, and focus on the first new card.
	async function loadMoreFromButton() {
		if (page >= pages) return;
		const previousCount = visible.length;
		automaticBatchesLeft = AUTOMATIC_BATCHES;
		await advance();
		postList?.querySelectorAll<HTMLAnchorElement>(".post-card-link")[previousCount]?.focus();
	}

	function sentinelInReach() {
		return sentinel !== undefined && sentinel.getBoundingClientRect().top < window.innerHeight + REACH_PX;
	}

	// The load-more area came into reach: spend the automatic budget, batch by
	// batch, while it stays in reach (the observer fires only when that
	// changes, so a viewport taller than a batch would otherwise stall).
	// Focus on the button (a keyboard user tabbing to it scrolls it into
	// view) leaves loading to that user.
	async function loadMoreFromScroll() {
		if (page >= pages || automaticBatchesLeft === 0 || sentinel?.contains(document.activeElement)) return;
		automaticBatchesLeft -= 1;
		await advance();
		if (sentinelInReach()) await loadMoreFromScroll();
	}

	onMount(() => {
		const requested = Number(new URLSearchParams(window.location.search).get("page") || 1);
		page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
		if (!sentinel || !("IntersectionObserver" in window)) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadMoreFromScroll();
			},
			{ rootMargin: `${REACH_PX}px` },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<div class="post-list" bind:this={postList}>
	{#each visible as post (post.slug)}
		<article class="post-card">
			<a href={post.href} class="card-image" tabindex="-1" aria-label={post.title}>
				<img src={post.image} alt={post.imageAlt} width={post.imageWidth ?? undefined} height={post.imageHeight ?? undefined} loading="lazy" decoding="async" />
			</a>
			<div class="card-copy">
				<svelte:element this={headingTag}><a class="post-card-link" href={post.href}>{post.title}</a></svelte:element>
				<p class="post-meta"><time datetime={post.published}>{post.dateLabel}</time> in <a href={post.categoryHref}>{post.categoryName}</a></p>
				{#if post.updatedLabel}<p class="post-meta">Updated <time datetime={post.updated}>{post.updatedLabel}</time></p>{/if}
				<p class="post-meta">{post.minutes} min read</p>
				{#if post.excerpt}<div class="card-excerpt">{@html post.excerpt}</div>{:else}<p>{post.description}</p>{/if}
			</div>
		</article>
	{/each}
</div>
{#if pages > 1}
	<div class="load-more" bind:this={sentinel}>
		<p role="status">Showing {visible.length} of {posts.length} articles</p>
		{#if page < pages}
			<Button variant="outline" size="lg" class={["load-more-button", automaticBatchesLeft === 0 && "paused"]} href={`?page=${page + 1}`} onclick={(event) => { event.preventDefault(); void loadMoreFromButton(); }}>Load more posts</Button>
		{:else}
			<p>You've reached the end. <a href="#top">Back to top</a></p>
		{/if}
	</div>
	<noscript><p><a href="/blog/all-posts/">Browse every article without JavaScript</a></p></noscript>
{/if}
