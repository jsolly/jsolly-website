<script>
	import { MEASUREMENT_POLICY } from "./ingredient-units.mjs";
</script>

<div class="measurement-assumptions-copy">
	<p>{MEASUREMENT_POLICY}</p>
	<h2>Choosing ingredient units</h2>
	<ul>
		<li><strong>Grams only:</strong> shows ingredient weights where a reliable conversion is available.</li>
		<li><strong>US imperial:</strong> uses US customary weights, cups and spoons.</li>
		<li><strong>Metric:</strong> uses grams for mass and millilitres for volume.</li>
	</ul>
	<h2>Cooking with converted quantities</h2>
	<p>An approximation marked ~ is a guide, not an exact measured weight. Keep the original measure and ingredient state in mind, and follow the recipe's cooking method, safe doneness checks and appliance capacity notes.</p>
	<p>Markdown and JSON downloads include the measurement explanation so it remains available when the recipe is used separately.</p>
</div>

<style>
	@layer properties, theme, base, components, utilities, blog, blog-no-script;
	@layer blog {
		.measurement-assumptions-copy { line-height: 1.7; }
		h2 { margin-top: 1.5rem; font-size: 1.25rem; }
		ul { padding-left: 1.5rem; }
		li { margin-block: 0.5rem; }
	}
</style>
