<script>
	import { groupBadges } from "./constants.mjs";

	// A recipe's group badge (Keto, Shared main or Not Keto) on its library
	// card and in the library dialog; `class` lets the dialog place it.
	let { group, class: className } = $props();
</script>

<span class={["badge", className]} class:shared={group === "shared"} class:nonketo={group === "nonketo"}>{groupBadges[group]}</span>

<style>
	/* Every recipe stylesheet declares the full order (as the blog sheets do), so
	   blog stays last whichever stylesheet the browser reads first. */
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.badge {
			font-size: 0.69rem;
			text-transform: uppercase;
			letter-spacing: 0.055em;
			font-weight: 750;
			border-radius: 6px;
			padding: 4px 7px;
			background: var(--recipe-badge);
		}
		.badge.shared {
			background: var(--recipe-badge-shared);
		}
		.badge.nonketo {
			background: var(--recipe-badge-nonketo);
		}
	}
</style>
