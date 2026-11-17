// The viewport widths each page is audited at, desktop then mobile.
export const WIDTHS = [1280, 390];

// One route per page template, plus each variant a template renders differently,
// audited at both widths in PR CI. `template` is the src/pages file that renders
// the route; every src/pages template needs at least one entry.
export const SAMPLE = [
	{ route: "/", template: "src/pages/index.astro" },
	{ route: "/about/", template: "src/pages/about.astro" },
	{ route: "/contact/", template: "src/pages/contact.astro" },
	{ route: "/privacy/", template: "src/pages/privacy.astro" },
	{ route: "/terms/", template: "src/pages/terms.astro" },
	{ route: "/404.html", template: "src/pages/404.astro" },
	{ route: "/500.html", template: "src/pages/500.astro" },
	{ route: "/blog/", template: "src/pages/blog/index.astro" },
	{ route: "/blog/all-posts/", template: "src/pages/blog/all-posts.astro" },
	// Blog categories: an active category and a retired-category notice.
	{
		route: "/blog/category/web-dev/",
		template: "src/pages/blog/category/[slug].astro",
	},
	{
		route: "/blog/category/uncategorized/",
		template: "src/pages/blog/category/[slug].astro",
	},
	{ route: "/blog/search/", template: "src/pages/blog/search.astro" },
	{ route: "/blog/works-cited/", template: "src/pages/blog/works-cited.astro" },
	// Blog posts: one with code blocks, tables and images, one with body
	// headings and an iframe embed, and one whose hero image has an attribution
	// caption.
	{
		route: "/blog/UI-enhancement-leads-to-major-architecture-changes/",
		template: "src/pages/blog/[slug].astro",
	},
	{
		route: "/blog/Adding-spell-check-django-ckeditor/",
		template: "src/pages/blog/[slug].astro",
	},
	{
		route: "/blog/Exploring-the-STAC-APIs-with-IPython-Notebooks/",
		template: "src/pages/blog/[slug].astro",
	},
	{ route: "/recipes/", template: "src/pages/recipes/index.astro" },
	{ route: "/recipes/all/", template: "src/pages/recipes/all.astro" },
	{ route: "/recipes/meals/", template: "src/pages/recipes/meals.astro" },
	{
		route: "/recipes/smoothies/",
		template: "src/pages/recipes/smoothies.astro",
	},
	{ route: "/recipes/saved/", template: "src/pages/recipes/saved.astro" },
	// Recipe pages: an original recipe, an imported `source-` recipe and a
	// retirement notice, which renders without the recipe island.
	{
		route: "/recipes/greek-turkey-patties/",
		template: "src/pages/recipes/[slug].astro",
	},
	{
		route: "/recipes/source-garlic-butter-chicken-with-cauliflower-rice/",
		template: "src/pages/recipes/[slug].astro",
	},
	{
		route: "/recipes/tomato-lentil-and-chicken-bake/",
		template: "src/pages/recipes/[slug].astro",
	},
];
