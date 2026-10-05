<script lang="ts">
	import { onMount, tick } from "svelte";
	import type { Card } from "../../lib/blog/types.js";

	// Without a pageSize every card renders and there is no load-more.
	let { posts, pageSize = Number.POSITIVE_INFINITY }: { posts: Card[]; pageSize?: number } = $props();
	let page = $state(1);
	const pages = $derived(Math.max(1, Math.ceil(posts.length / pageSize)));
	const visible = $derived(posts.slice(0, page * pageSize));
	let sentinel = $state<HTMLDivElement>();
	let automaticBatchesLeft = $state(3);
	let postList = $state<HTMLDivElement>();
	async function loadMore(manual = false) {
		if (page >= pages) return;
		const previousCount = visible.length;
		if (manual) automaticBatchesLeft = 3;
		else automaticBatchesLeft -= 1;
		page += 1;
		const url = new URL(window.location.href);
		url.searchParams.set("page", String(page));
		window.history.replaceState(null, "", url);
		if (manual) {
			await tick();
			postList?.querySelectorAll<HTMLAnchorElement>(".post-card-link")[previousCount]?.focus();
		}
	}
	onMount(() => {
		const requested = Number(new URLSearchParams(window.location.search).get("page") || 1);
		page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
		if (!sentinel || !("IntersectionObserver" in window)) return;
		const observer = new IntersectionObserver(
			(entries) => {
				// Focus on the button (a keyboard user tabbing to it scrolls it into
				// view) leaves loading to that user.
				if (sentinel?.contains(document.activeElement)) return;
				if (automaticBatchesLeft > 0 && entries.some((entry) => entry.isIntersecting)) void loadMore();
			},
			{ rootMargin: "200px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<div class="post-list" bind:this={postList}>
	{#each visible as post (post.slug)}
		<article class="post-card">
			<a href={`/blog/${post.slug}/`} class="card-image" tabindex="-1" aria-label={post.title}>
				<img src={post.image} alt={post.imageAlt} width={post.imageWidth ?? undefined} height={post.imageHeight ?? undefined} loading="lazy" decoding="async" />
			</a>
			<div class="card-copy">
				<h2><a class="post-card-link" href={`/blog/${post.slug}/`}>{post.title}</a></h2>
				<p class="post-meta"><time datetime={post.published}>{post.dateLabel}</time> in <a href={`/blog/category/${post.category}/`}>{post.categoryName}</a></p>
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
			<a class="load-more-button" class:paused={automaticBatchesLeft === 0} href={`?page=${page + 1}`} onclick={(event) => { event.preventDefault(); void loadMore(true); }}>Load more posts</a>
		{:else}
			<p>You've reached the end. <a href="#top">Back to top</a></p>
		{/if}
	</div>
	<noscript><p><a href="/blog/all-posts/">Browse every article without JavaScript</a></p></noscript>
{/if}
