import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import it from "node:test";
import { parseFrontmatter } from "astro/markdown";
import { JSDOM } from "jsdom";
import { cookingText } from "../../src/components/recipes/cooking-quantities.mjs";
import { formatIngredient } from "../../src/components/recipes/recipe-logic.mjs";
import data from "../../src/components/recipes/recipes.json" with {
	type: "json",
};
import { markdownRoutes, routes } from "../../src/generated/route-manifest.js";
import { pageMarkdown } from "../markdown-build.mjs";
import { allPosts, distFiles } from "./pages.mjs";

const MISSING_CANONICAL = /canonical URL/u;
const INGREDIENT_SECTION = /## Ingredients\n(?<body>[\s\S]*?)(?=\n## |$)/u;
const UNRESOLVED_QUANTITY = /\{\{/u;
const COOK_SECTION = /## Cook\n(?<body>[\s\S]*?)(?=\n## |$)/u;

// Expected content comes from source JSON and the separately tested quantity
// formatter, never the Markdown exporter that writes these backing files.
function cookingContentGaps(markdown, recipe) {
	const gaps = [];
	const check = (condition, message) => {
		if (!condition) gaps.push(message);
	};
	check(
		!UNRESOLVED_QUANTITY.test(markdown),
		`${recipe.id} resolves every cooking quantity`,
	);
	const text = (value) =>
		cookingText(recipe, value, { servings: 4, units: "us" });
	const ingredients = markdown.match(INGREDIENT_SECTION)?.groups.body ?? "";
	const cooking = markdown.match(COOK_SECTION)?.groups.body ?? "";
	for (const ingredient of recipe.ingredients) {
		const quantity = formatIngredient(ingredient, 4, "us", {
			wholeOunces: recipe.type === "smoothie",
		});
		check(
			ingredients.includes(`- ${quantity} ${ingredient.name}`),
			`${recipe.id} retains ingredient ${ingredient.name} at four servings`,
		);
		for (const detail of [ingredient.state, ingredient.note].filter(Boolean))
			check(
				ingredients.includes(text(detail)),
				`${recipe.id} retains ingredient details`,
			);
	}
	for (const [index, step] of recipe.steps.entries())
		check(
			cooking.includes(`${index + 1}. **${step.title}.** ${text(step.text)}`),
			`${recipe.id} retains cooking step ${index + 1} and its endpoints`,
		);
	const safety =
		recipe.type === "smoothie"
			? "Wash fresh produce and use a clean blender. Keep yogurt and finished smoothies chilled."
			: "Prepare cold sides first. Keep raw-poultry tools separate; use clean serving utensils. Probe more than one thick piece. A timer is not a doneness test.";
	check(cooking.includes(safety), `${recipe.id} retains safety instructions`);
	for (const limit of recipe.limitations)
		check(
			markdown.includes(text(limit)),
			`${recipe.id} retains cooking limits`,
		);
	return gaps;
}

it("Markdown conversion retains authored complex HTML and stable anchors without navigation controls", () => {
	const source = `<!doctype html><link rel="canonical" href="https://www.jsolly.com/blog/Case/">
	<main><article><h1 id="Case">Case</h1><div class="article-body"><h2 id="authored-id">Section <a class="heading-link" href="#authored-id">#</a></h2>
	<a href="../Other/#Kept">Other</a><table><tr><td colspan="2">Wide cell</td></tr></table>
	<iframe src="https://www.youtube-nocookie.com/embed/example" title="Video"></iframe>
	<pre><code>const x = "&lt;b&gt;";\n  preserve  spaces</code></pre><button>Copy</button></div></article></main>`;
	const markdown = pageMarkdown(source);
	assert.ok(markdown.includes('<a id="authored-id"></a>'));
	assert.ok(
		markdown.includes("[Other](https://www.jsolly.com/blog/Other/#Kept)"),
	);
	// biome-ignore lint/security/noSecrets: authored table fixture markup, not a credential.
	assert.ok(markdown.includes('<td colspan="2">Wide cell</td>'));
	assert.ok(
		markdown.includes('src="https://www.youtube-nocookie.com/embed/example"'),
	);
	assert.ok(markdown.includes('const x = "&lt;b&gt;";\n  preserve  spaces'));
	assert.ok(!markdown.includes("Copy"));
	assert.ok(!markdown.includes("heading-link"));
	assert.throws(
		() => pageMarkdown("<main>Missing canonical</main>"),
		MISSING_CANONICAL,
	);
});

it("Every published blog and recipe page has one static Markdown sibling and every draft stays absent", async () => {
	const files = await distFiles();
	assert.deepEqual(
		markdownRoutes.map(([key]) => `${key}/`).sort(),
		routes
			.filter(
				(route) => route.startsWith("/blog/") || route.startsWith("/recipes/"),
			)
			.sort(),
	);
	assert.equal(
		new Set(markdownRoutes.map(([, file]) => file)).size,
		markdownRoutes.length,
	);
	for (const [key, file] of markdownRoutes) {
		assert.ok(files.has(file.slice(1)), `${key} has a generated sibling`);
	}
	const drafts = (await allPosts()).filter((candidate) => !candidate.published);
	for (const post of drafts) {
		assert.ok(
			!files.has(`blog/${post.slug}.md`),
			`${post.slug} is not published as Markdown`,
		);
	}
});

it("Published article Markdown preserves rendered author, timestamps, heading IDs and image destinations", async () => {
	await Promise.all(
		(await allPosts())
			.filter((post) => post.published)
			.map(async (post) => {
				const markdown = await readFile(
					join("dist/blog", `${post.slug}.md`),
					"utf8",
				);
				const { frontmatter } = parseFrontmatter(markdown);
				assert.equal(
					frontmatter.canonical,
					`https://www.jsolly.com/blog/${post.slug}/`,
				);
				const dom = new JSDOM(
					await readFile(join("dist/blog", post.slug, "index.html"), "utf8"),
				);
				try {
					const document = dom.window.document;
					const structured = [
						...document.querySelectorAll('script[type="application/ld+json"]'),
					]
						.map((node) => JSON.parse(node.textContent))
						.find((entry) => entry["@type"] === "BlogPosting");
					assert.equal(frontmatter.author, structured.author.name);
					assert.equal(frontmatter.published, structured.datePublished);
					assert.equal(frontmatter.updated, structured.dateModified);
					for (const heading of document.querySelectorAll(
						".article-body h1[id], .article-body h2[id], .article-body h3[id], .article-body h4[id]",
					)) {
						assert.ok(
							markdown.includes(`id="${heading.id}"`),
							`${post.slug} keeps ${heading.id}`,
						);
					}
					for (const image of document.querySelectorAll(
						".article-body img[src]",
					)) {
						assert.ok(
							markdown.includes(
								new URL(image.getAttribute("src"), frontmatter.canonical).href,
							),
							`${post.slug} keeps its image destination`,
						);
					}
				} finally {
					dom.window.close();
				}
			}),
	);
});

it("Each recipe Markdown contains its instructions and source uncertainty with canonical settings", async () => {
	const library = JSON.parse(
		await readFile("dist/recipes/data/recipe-library.json", "utf8"),
	);
	assert.equal(library.schemaVersion, 2);
	const guide = await readFile("dist/llms.txt", "utf8");
	assert.ok(
		guide.includes("https://www.jsolly.com/recipes/data/recipe-library.json"),
	);
	await Promise.all(
		[
			["meals", "meal"],
			["smoothies", "smoothie"],
		].map(async ([collection, type]) => {
			const dom = new JSDOM(
				await readFile(`dist/recipes/${collection}/index.html`, "utf8"),
			);
			try {
				const hrefs = new Set(
					[...dom.window.document.querySelectorAll("a.open-button")].map(
						(link) => link.getAttribute("href"),
					),
				);
				assert.deepEqual(
					hrefs,
					new Set(
						data.recipes
							.filter((recipe) => recipe.type === type)
							.map((recipe) => `/recipes/${recipe.id}/`),
					),
					`${collection} links every recipe directly to its canonical URL`,
				);
			} finally {
				dom.window.close();
			}
		}),
	);
	await Promise.all(
		data.recipes.map(async (recipe) => {
			const dom = new JSDOM(
				await readFile(`dist/recipes/${recipe.id}/index.html`, "utf8"),
			);
			try {
				const document = dom.window.document;
				assert.equal(
					document
						// biome-ignore lint/security/noSecrets: HTML metadata selector, not a credential.
						.querySelector('link[rel="related"][type="application/json"]')
						?.getAttribute("href"),
					"/recipes/data/recipe-library.json",
				);
				assert.equal(
					document
						// biome-ignore lint/security/noSecrets: HTML metadata selector, not a credential.
						.querySelector('link[rel="alternate"][type="text/markdown"]')
						?.getAttribute("href"),
					`/recipes/${recipe.id}.md`,
				);
				assert.equal(
					document
						.querySelector('meta[property="og:image"]')
						?.getAttribute("content"),
					`https://www.jsolly.com${recipe.image.src}`,
				);
				assert.equal(
					document
						.querySelector('meta[property="og:image:alt"]')
						?.getAttribute("content"),
					recipe.image.alt,
				);
				assert.equal(
					document.querySelector("h1")?.textContent.trim(),
					recipe.title,
				);
				assert.equal(
					document.body.textContent.includes("Download Markdown"),
					false,
				);
				assert.equal(
					document.body.textContent.includes("Download JSON"),
					false,
				);
				assert.equal(
					library.recipes.filter((entry) => entry.recipeId === recipe.id)
						.length,
					1,
				);
			} finally {
				dom.window.close();
			}
			const markdown = await readFile(`dist/recipes/${recipe.id}.md`, "utf8");
			assert.deepEqual(cookingContentGaps(markdown, recipe), []);
			assert.ok(markdown.includes(recipe.title), recipe.id);
			assert.ok(
				markdown.includes(recipe.image.src),
				`${recipe.id} retains its illustration`,
			);
			assert.ok(
				markdown.includes(recipe.image.caption),
				`${recipe.id} retains its illustration disclosure`,
			);
			assert.ok(
				markdown.includes(`https://www.jsolly.com/recipes/${recipe.id}/`),
			);
			assert.ok(
				markdown.includes("canonical four-serving recipe in US measures"),
			);
			assert.ok(
				markdown.includes(
					"query parameters do not change this static Markdown",
				),
			);
			for (const source of recipe.sources)
				assert.ok(
					markdown.includes(source.url),
					`${recipe.id} retains ${source.url}`,
				);
			assert.ok(
				markdown.includes(recipe.sourceRecipe?.nutritionBasis ?? ""),
				`${recipe.id} retains nutrition uncertainty`,
			);
		}),
	);
});

it("Generated recipe fidelity rejects omitted ingredients, steps and safety instructions", async () => {
	const recipe = data.recipes[0];
	const markdown = await readFile(`dist/recipes/${recipe.id}.md`, "utf8");
	const mutations = [
		markdown.replace(INGREDIENT_SECTION, ""),
		markdown.replace(COOK_SECTION, ""),
		markdown.replace(
			cookingText(recipe, recipe.steps[0].text, { servings: 4, units: "us" }),
			"Method omitted",
		),
		`${markdown}\n{{quantity:unresolved}}`,
		markdown.replace("A timer is not a doneness test.", ""),
	];
	for (const body of mutations)
		assert.notDeepEqual(
			cookingContentGaps(body, recipe),
			[],
			"omitted cooking content must fail fidelity",
		);
});
