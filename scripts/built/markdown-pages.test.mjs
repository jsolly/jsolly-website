import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { it } from "vitest";
import middleware from "../../middleware.js";
import { cookingText } from "../../src/components/recipes/cooking-quantities.mjs";
import data from "../../src/components/recipes/recipe-data.server.mjs";
import { formatIngredient } from "../../src/components/recipes/recipe-logic.mjs";
import { markdownRoutes, routes } from "../../src/generated/route-manifest.js";
import { pageMarkdown } from "../markdown-build.mjs";
import { markdownHtmlFacts } from "./markdown-html.mjs";
import { allPosts, distFiles, readBuiltPages } from "./pages.mjs";

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
		recipe.safety ||
		(recipe.type === "smoothie"
			? "Wash fresh produce and use a clean blender. Keep yogurt and finished smoothies chilled."
			: "Prepare cold sides first. Keep raw-poultry tools separate; use clean serving utensils. Probe more than one thick piece. A timer is not a doneness test.");
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
				const facts = markdownHtmlFacts(
					await readFile(join("dist/blog", post.slug, "index.html"), "utf8"),
				);
				const structured = facts.structured.find(
					(entry) => entry["@type"] === "BlogPosting",
				);
				assert.equal(frontmatter.author, structured.author.name);
				assert.equal(frontmatter.published, structured.datePublished);
				assert.equal(frontmatter.updated, structured.dateModified);
				for (const id of facts.headingIds)
					assert.ok(
						markdown.includes(`id="${id}"`),
						`${post.slug} keeps ${id}`,
					);
				for (const src of facts.articleImages)
					assert.ok(
						markdown.includes(new URL(src, frontmatter.canonical).href),
						`${post.slug} keeps its image destination`,
					);
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
			const facts = markdownHtmlFacts(
				await readFile(`dist/recipes/${collection}/index.html`, "utf8"),
			);
			assert.deepEqual(
				new Set(facts.openLinks),
				new Set(
					data.recipes
						.filter((recipe) => recipe.type === type)
						.slice(0, 6)
						.map((recipe) => `/recipes/${recipe.id}/`),
				),
				`${collection} links its first six recipes directly to canonical URLs`,
			);
		}),
	);
	await Promise.all(
		data.recipes.map(async (recipe) => {
			const facts = markdownHtmlFacts(
				await readFile(`dist/recipes/${recipe.id}/index.html`, "utf8"),
			);
			assert.equal(facts.related, "/recipes/data/recipe-library.json");
			assert.equal(facts.alternate, `/recipes/${recipe.id}.md`);
			assert.equal(facts.image, `https://www.jsolly.com${recipe.image.src}`);
			assert.equal(facts.imageAlt, recipe.image.alt);
			assert.equal(facts.title, recipe.title);
			assert.equal(facts.bodyText.includes("Download Markdown"), false);
			assert.equal(facts.bodyText.includes("Download JSON"), false);
			assert.equal(
				library.recipes.filter((entry) => entry.recipeId === recipe.id).length,
				1,
			);
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

// Copied from the Context7 Ask install instructions, not from constants.ts.
const SEARCH_SECTION =
	// biome-ignore lint/security/noSecrets: public site verification key, not a credential
	"## Search\n\nThis site has a search endpoint: https://context7.com/api/v2/ask?siteKey=ask_43369889032b1355b89bc7f4&query=<URL-encoded question>. It returns documentation that answers the question, with a source link for each part. No API key is needed. If nothing matches, it says so.\n";
// The install instructions' own grep patterns for the verification checks.
const VERIFICATION_TAG = /<meta name="context7-site-verification"[^>]*>/u;
const SEARCH_NOTE = /This site has a search endpoint[^<]*/u;

it("Context7 finds its verification tag and hidden search note on every built page, each page opens its headings with its own h1, and every Markdown sibling ends with Search", async () => {
	const pages = await readBuiltPages();
	assert.ok(pages.length > 0);
	for (const { file, html } of pages) {
		assert.equal(
			html.match(VERIFICATION_TAG)?.[0],
			// biome-ignore lint/security/noSecrets: public site verification key, not a credential
			'<meta name="context7-site-verification" content="ask_43369889032b1355b89bc7f4">',
			`${file} carries the verification tag`,
		);
		assert.equal(
			html.match(SEARCH_NOTE)?.[0],
			// biome-ignore lint/security/noSecrets: public site verification key, not a credential
			"This site has a search endpoint: https://context7.com/api/v2/ask?siteKey=ask_43369889032b1355b89bc7f4&amp;query=&lt;URL-encoded question&gt;. It returns documentation that answers the question, with a source link for each part. No API key is needed. If nothing matches, it says so.",
			`${file} carries the search note`,
		);
		const { note, firstHeading, noteHeading } = markdownHtmlFacts(html);
		assert.equal(note.hidden, "true", file);
		assert.ok(note.screenReaderOnly, `${file} hides the note`);
		assert.ok(note.firstInBody, `${file} opens its body with the note`);
		assert.equal(noteHeading, null, `${file} keeps the note label unheaded`);
		assert.equal(firstHeading, "h1", `${file} opens its headings with its h1`);
	}
	for (const [key, file] of markdownRoutes) {
		// biome-ignore lint/performance/noAwaitInLoops: bounded build pages are read sequentially.
		const markdown = await readFile(join("dist", file), "utf8");
		assert.ok(
			markdown.endsWith(`\n\n${SEARCH_SECTION}`),
			`${key} ends with Search`,
		);
		assert.equal(
			markdown.split("This site has a search endpoint").length,
			2,
			`${key} offers the search endpoint exactly once`,
		);
	}
});

const SEARCH_LINK =
	// biome-ignore lint/security/noSecrets: public site verification key, not a credential
	'<https://context7.com/api/v2/ask?siteKey=ask_43369889032b1355b89bc7f4>; rel="search"; type="text/plain"; title="Search jsolly.com"';

// A no-JavaScript recipe search submission, which the middleware rewrites to the browse function.
// biome-ignore lint/security/noSecrets: a recipe search URL, not a credential
const NATIVE_RECIPE_SEARCH = "/recipes/meals/?browse=1&q=salmon";

it("A browser or crawler fetching an HTML page or a no-JavaScript recipe search gets the search Link header, and static files and 406s do not", () => {
	const answer = (path, accept = "text/html", method = "GET") =>
		middleware(
			new Request(`https://www.jsolly.com${path}`, {
				method,
				headers: { accept },
			}),
		);
	for (const path of [
		"/about/",
		"/blog/",
		"/recipes/greek-turkey-patties/",
		NATIVE_RECIPE_SEARCH,
	]) {
		assert.equal(answer(path).headers.get("link"), SEARCH_LINK, path);
	}
	assert.ok(
		answer(NATIVE_RECIPE_SEARCH).headers.get("x-middleware-rewrite"),
		"the no-JavaScript search is the browse rewrite",
	);
	for (const path of ["/llms.txt", "/favicon.ico", "/blog/rss.xml"]) {
		assert.equal(answer(path).headers.get("link"), null, path);
	}
	assert.equal(
		answer("/about/", "text/html", "HEAD").headers.get("link"),
		SEARCH_LINK,
		"a crawler's HEAD probe sees the search Link",
	);
	assert.equal(
		answer("/about/", "text/html", "POST").headers.get("link"),
		null,
		"a POST is not a page response",
	);
	const rejected = answer("/about/", "application/json");
	assert.equal(rejected.status, 406);
	assert.equal(rejected.headers.get("link"), null);
});
