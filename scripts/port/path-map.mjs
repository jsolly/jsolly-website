// The blogthedata → jsolly path map (merge plan §1.2, §1.4, §1.6, §1.8) as
// data, and the one definition of "content" the port tools share:
//
// - import-awesome-blog.mjs imports areas along it, and --resync re-imports
//   the content areas;
// - freeze-check.mjs and --resync judge every changed SRC path with
//   classifyContentPath (contentChanges): mapped or deliberately excluded
//   content passes, anything else is frozen;
// - url-map-sync.mjs derives the legacy URLs each content file needs, and
//   rewrite-content.mjs reads them back from DST for content without a row.
//
// Code areas are only the starting point: their step adapts the files by hand.
// Files the plan merges or splits (lib frontmatter/cards/utils, the
// global/article-content/motion/no-script styles, the astro-contract, browse,
// search and PWA tests, the privacy page, the root configs) have no entry;
// their step reads them with `git show`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { JSOLLY_ORIGIN } from "../blogthedata-redirects.mjs";
import {
	biomeFormat,
	DROPPED_RECIPE_POST,
	formatJson,
	git,
	groupsOf,
	splitFrontmatter,
} from "./lib.mjs";

const MARKDOWN_FILE = /^[^/.][^/]*\.md$/u;
const JSON_FILE = /^[^/]+\.json$/u;
const NOT_RECIPE_MEDIA = /^(?!recipes\/)/u;
const EXTENSION = /\.[^.]+$/u;
const RECIPE_MEDIA_PATH = /\/media\/recipes\//gu;
const OLD_RECIPE_POST = new RegExp(
	`/post/${DROPPED_RECIPE_POST}/(?=["#?\\s]|$)`,
	"gu",
);
const DRAFT = /^draft:[ \t]*(?<value>[^#\n]*?)[ \t]*(?:#.*)?$/mu;
const YAML_FALSE = new Set(["false", "False", "FALSE"]);
const YAML_TRUE = new Set(["true", "True", "TRUE"]);

function biomeFile(to, blob) {
	return biomeFormat(to, blob.toString("utf8"));
}

// PagesCMS's own serialization, JSON.stringify(x, null, 2) with no final
// newline (plan §1.5), so the first CMS save is a no-op diff.
function pagesCmsJson(_to, blob) {
	return JSON.stringify(JSON.parse(blob.toString("utf8")), null, 2);
}

function mapRecipeStrings(value) {
	if (typeof value === "string") {
		return value
			.replace(RECIPE_MEDIA_PATH, "/recipes/media/")
			.replace(OLD_RECIPE_POST, "/recipes/");
	}
	if (Array.isArray(value)) {
		return value.map(mapRecipeStrings);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, mapRecipeStrings(item)]),
		);
	}
	return value;
}

// The JSON-aware recipe path rewrite (§1.6), checked by parse deep-equality,
// then Biome.
function recipeJson(to, blob) {
	const mapped = mapRecipeStrings(JSON.parse(blob.toString("utf8")));
	const output = formatJson(to, mapped);
	if (!isDeepStrictEqual(JSON.parse(output), mapped)) {
		throw new Error(`${to}: formatted JSON no longer equals the mapped data`);
	}
	return output;
}

// Whether a post's text is published. A missing `draft` defaults to true, as
// the collection schema does; anything but a YAML boolean fails.
function isPublished(name, text) {
	const { yaml } = splitFrontmatter(text);
	if (yaml === undefined) {
		throw new Error(`${name} has no frontmatter`);
	}
	const value = groupsOf(DRAFT, yaml)?.value;
	if (value === undefined || YAML_TRUE.has(value)) {
		return false;
	}
	if (YAML_FALSE.has(value)) {
		return true;
	}
	throw new Error(`${name}: cannot read draft: ${value}`);
}

function slugOf(rest) {
	return rest.replace(EXTENSION, "");
}

// A page's legacy URL: the row's source plus its served /index.html form.
function page(prefix, rowClass, source, destinationPath) {
	return {
		prefix,
		class: rowClass,
		source,
		destination: `${JSOLLY_ORIGIN}${destinationPath}`,
		paths: [source, `${source}index.html`],
	};
}

function media(source, destinationPath) {
	return {
		prefix: "MED",
		class: "asset-media",
		source,
		destination: `${JSOLLY_ORIGIN}${destinationPath}`,
		paths: [source],
	};
}

// area → { step, content, entries }. An entry whose `from` ends in "/" maps
// every SRC file under that directory (filtered by `match` on the remainder,
// minus `exclude`) to the same remainder under `to`; any other entry is one
// file. `transform(to, blob)` gives the DST bytes (default: SRC's bytes).
// `content` areas are the freeze notice's allowlist; their `legacy(rest, read)`
// lists the old blogthedata.com URLs a file publishes, for url-map-sync.
export const AREAS = {
	posts: {
		step: "B03",
		content: true,
		entries: [
			{
				from: "src/content/posts/",
				to: "src/content/blog/posts/",
				match: MARKDOWN_FILE,
				exclude: [`${DROPPED_RECIPE_POST}.md`],
				legacy: (rest, read) =>
					isPublished(rest, read())
						? [
								page(
									"PST",
									"post",
									`/post/${slugOf(rest)}/`,
									`/blog/${slugOf(rest)}/`,
								),
							]
						: [],
			},
			// Shell globs skip dotfiles, so the lint config is an explicit entry.
			{
				from: "src/content/posts/.markdownlint.json",
				to: "src/content/blog/posts/.markdownlint.json",
				transform: biomeFile,
			},
		],
	},
	categories: {
		step: "B03",
		content: true,
		entries: [
			{
				from: "src/content/categories/",
				to: "src/content/blog/categories/",
				match: JSON_FILE,
				transform: pagesCmsJson,
				legacy: (rest) => [
					page(
						"CAT",
						"category",
						`/category/${slugOf(rest)}/`,
						`/blog/category/${slugOf(rest)}/`,
					),
				],
			},
		],
	},
	"blog-media": {
		step: "B06c",
		content: true,
		entries: [
			{
				from: "public/media/",
				to: "public/blog/media/",
				match: NOT_RECIPE_MEDIA,
				legacy: (rest) => [media(`/media/${rest}`, `/blog/media/${rest}`)],
			},
		],
	},
	"recipe-data": {
		step: "B15",
		content: true,
		entries: [
			{
				from: "src/components/recipes/recipes.json",
				to: "src/components/recipes/recipes.json",
				transform: recipeJson,
				legacy: (_rest, read) =>
					JSON.parse(read())
						.recipes.map((recipe) => recipe.id)
						.sort()
						.map((id) =>
							page("RCP", "recipe-page", `/recipes/${id}/`, `/recipes/${id}/`),
						),
			},
			{
				from: "src/components/recipes/nutrition-data.json",
				to: "src/components/recipes/nutrition-data.json",
				transform: recipeJson,
			},
		],
	},
	"recipe-media": {
		step: "B15",
		content: true,
		entries: [
			{
				from: "public/media/recipes/",
				to: "public/recipes/media/",
				legacy: (rest) => [
					media(`/media/recipes/${rest}`, `/recipes/media/${rest}`),
				],
			},
		],
	},
	"blog-lib": {
		step: "B05",
		entries: [
			{ from: "src/content.config.ts", to: "src/content.config.ts" },
			{ from: "src/lib/post-loader.ts", to: "src/lib/blog/post-loader.ts" },
			{ from: "src/lib/html.ts", to: "src/lib/blog/html.ts" },
			{ from: "src/lib/search.ts", to: "src/lib/blog/search.ts" },
		],
	},
	"blog-styles": {
		step: "B06b",
		entries: [
			{ from: "src/styles/theme.css", to: "src/styles/blog/theme.css" },
			{ from: "src/styles/ui.css", to: "src/styles/blog/ui.css" },
		],
	},
	"blog-chrome": {
		step: "B06c",
		entries: [
			{
				from: "public/topographic-logo.svg",
				to: "public/blog/topographic-logo.svg",
			},
			{ from: "public/social/", to: "public/blog/social/" },
		],
	},
	"blog-layout": {
		step: "B06c",
		entries: [
			{ from: "src/layouts/Base.astro", to: "src/layouts/BlogLayout.astro" },
			{
				from: "src/components/Navigation.svelte",
				to: "src/components/blog/BlogNavigation.svelte",
			},
			{ from: "src/lib/content.ts", to: "src/lib/blog/content.ts" },
			{
				from: "src/lib/components/ui/input/input.svelte",
				to: "src/lib/components/ui/input.svelte",
			},
			{
				from: "src/pages/works-cited/index.astro",
				to: "src/pages/blog/works-cited.astro",
			},
		],
	},
	"blog-browse": {
		step: "B07",
		entries: [
			{
				from: "src/components/PostCards.svelte",
				to: "src/components/blog/PostCards.svelte",
			},
			{
				from: "src/components/About.astro",
				to: "src/components/blog/AuthorCard.astro",
			},
			{ from: "src/pages/index.astro", to: "src/pages/blog/index.astro" },
			{
				from: "src/pages/all-posts/index.astro",
				to: "src/pages/blog/all-posts.astro",
			},
			{
				from: "src/pages/category/[slug]/index.astro",
				to: "src/pages/blog/category/[slug].astro",
			},
		],
	},
	"blog-post": {
		step: "B08",
		entries: [
			{
				from: "src/pages/post/[slug]/index.astro",
				to: "src/pages/blog/[slug].astro",
			},
		],
	},
	"blog-search": {
		step: "B09",
		entries: [
			{
				from: "src/pages/search/index.astro",
				to: "src/pages/blog/search.astro",
			},
			{
				from: "src/pages/search-index.json.ts",
				to: "src/pages/blog/search-index.json.ts",
			},
			{
				from: "src/components/Search.svelte",
				to: "src/components/blog/Search.svelte",
			},
		],
	},
	"blog-feeds": {
		step: "B10",
		entries: [
			{ from: "src/lib/feeds.ts", to: "src/lib/blog/feeds.ts" },
			{ from: "src/pages/rss/index.ts", to: "src/pages/blog/rss.xml.ts" },
			{ from: "src/pages/atom/index.ts", to: "src/pages/blog/atom.xml.ts" },
		],
	},
	"site-files": {
		step: "B11",
		entries: [
			{ from: "public/pgp-key.txt", to: "public/pgp-key.txt" },
			{
				from: "public/.well-known/security.txt",
				to: "public/.well-known/security.txt",
			},
		],
	},
	"pages-config": {
		step: "B13",
		entries: [{ from: ".pages.yml", to: ".pages.yml" }],
	},
	"recipe-modules": {
		step: "B15",
		entries: [
			...[
				"recipe-logic",
				"display-units",
				"nutrition",
				"nutrient-filters",
				"recipe-export",
				"trn-logic",
			].flatMap((name) => [
				sameFile(`src/components/recipes/${name}.mjs`),
				sameFile(`src/components/recipes/${name}.test.mjs`),
			]),
			sameFile("scripts/recipes/sync-assistant-data.mjs"),
		],
	},
	"recipe-detail": {
		step: "B16",
		entries: [
			...[
				"RecipePage.svelte",
				"RecipeBody.svelte",
				"RecipeFlow.svelte",
				"RecipePrint.svelte",
				"ShareRecipe.svelte",
				"ApplianceIcon.svelte",
				"NutrientDisclosure.svelte",
				"recipe-url.mjs",
				"ingredient-icon.mjs",
				"recipe-print-session.mjs",
			].map((name) => sameFile(`src/components/recipes/${name}`)),
			sameFile("src/pages/recipes/[slug].astro"),
			...uiFiles("dialog", [
				"dialog",
				"dialog-content",
				"dialog-description",
				"dialog-overlay",
				"dialog-portal",
				"dialog-title",
			]),
			...uiFiles("collapsible", [
				"collapsible",
				"collapsible-content",
				"collapsible-trigger",
			]),
			...uiFiles("checkbox", ["checkbox"]),
			...uiFiles("native-select", ["native-select"]),
			{
				from: "src/styles/recipes-theme.css",
				to: "src/styles/recipes/recipes-theme.css",
			},
		],
	},
	"recipe-landing": {
		step: "B17",
		entries: [
			...[
				"RecipeExperience.astro",
				"RecipeLibrary.svelte",
				"FilterMultiSelect.svelte",
				"NutritionHelp.svelte",
			].map((name) => sameFile(`src/components/recipes/${name}`)),
			...uiFiles("popover", [
				"popover",
				"popover-content",
				"popover-portal",
				"popover-trigger",
			]),
		],
	},
	"recipe-pwa": {
		step: "B18",
		entries: [
			sameFile("src/components/recipes/RecipePwa.astro"),
			sameFile("src/components/recipes/recipe-pwa-client.mjs"),
			sameFile("scripts/recipes/pwa-build.mjs"),
			{ from: "public/recipes-pwa/", to: "public/recipes/pwa/" },
		],
	},
};

function sameFile(path) {
	return { from: path, to: path };
}

// shadcn parts flatten from ui/<group>/<part>.svelte to ui/<part>.svelte (§1.4).
function uiFiles(group, parts) {
	return parts.map((part) => ({
		from: `src/lib/components/ui/${group}/${part}.svelte`,
		to: `src/lib/components/ui/${part}.svelte`,
	}));
}

// Every SRC path at `files` an entry covers.
function entryPairs(entry, files) {
	if (!entry.from.endsWith("/")) {
		return files.includes(entry.from)
			? [{ from: entry.from, to: entry.to, rest: "" }]
			: [];
	}
	return files
		.filter((path) => path.startsWith(entry.from))
		.map((path) => path.slice(entry.from.length))
		.filter((rest) => (entry.match ? entry.match.test(rest) : true))
		.filter((rest) => !entry.exclude?.includes(rest))
		.map((rest) => ({
			from: `${entry.from}${rest}`,
			to: `${entry.to}${rest}`,
			rest,
		}));
}

// The { from, to, rest, entry } mappings of the named areas at one SRC tree.
// With `strict`, an entry matching no SRC file means the map is wrong for this
// SHA, which fails loud.
export function areaMappings(names, files, { strict = true } = {}) {
	return names.flatMap((name) => {
		const area = AREAS[name];
		if (!area) {
			throw new Error(
				`unknown area ${name}; areas: ${Object.keys(AREAS).join(", ")}`,
			);
		}
		return area.entries.flatMap((entry) => {
			const pairs = entryPairs(entry, files);
			if (strict && pairs.length === 0) {
				throw new Error(`area ${name}: no SRC file matches ${entry.from}`);
			}
			return pairs.map((pair) => ({ ...pair, entry }));
		});
	});
}

const CONTENT_ENTRIES = Object.values(AREAS)
	.filter((area) => area.content)
	.flatMap((area) => area.entries);
// SRC files generated from content (recipes.json): content for the freeze, but
// never imported, since B15's `npm run recipes:sync` regenerates them.
const DERIVED = new Set([
	"public/data/recipe-library.json",
	"public/data/recipe-library.md",
]);

// Every content mapping at one SRC tree, in area order.
export function contentMappings(files) {
	return areaMappings(
		Object.keys(AREAS).filter((name) => AREAS[name].content),
		files,
		{ strict: false },
	);
}

// What one SRC path is to the port, from its name alone:
// - "mapped": a content entry carries it (with the mapping);
// - "excluded": content the port leaves out on purpose (the J7 recipe post,
//   the derived recipe library), with the reason;
// - "unmapped": under a content root, but no entry carries it (a port gap);
// - "outside": not content, so frozen.
export function classifyContentPath(path) {
	if (DERIVED.has(path)) {
		return { kind: "excluded", reason: "regenerated by B15's recipes:sync" };
	}
	let underRoot = false;
	for (const entry of CONTENT_ENTRIES) {
		if (!entry.from.endsWith("/")) {
			if (path === entry.from) {
				return {
					kind: "mapped",
					mapping: { from: path, to: entry.to, rest: "", entry },
				};
			}
			continue;
		}
		if (!path.startsWith(entry.from)) {
			continue;
		}
		underRoot = true;
		const rest = path.slice(entry.from.length);
		if (entry.exclude?.includes(rest)) {
			return { kind: "excluded", reason: "dropped from the port, J7" };
		}
		if (!entry.match || entry.match.test(rest)) {
			return {
				kind: "mapped",
				mapping: { from: path, to: `${entry.to}${rest}`, rest, entry },
			};
		}
	}
	return { kind: underRoot ? "unmapped" : "outside" };
}

// Every path that changed between two SRC commits, classified. Renames count
// as a delete and an add, so both paths are judged.
export function contentChanges(src, from, to) {
	const fields = git(src, [
		"diff",
		"--no-renames",
		"--name-status",
		"-z",
		from,
		to,
	]).split("\0");
	const changes = [];
	for (let index = 0; index + 1 < fields.length; index += 2) {
		const [status, path] = [fields[index], fields[index + 1]];
		changes.push({ status, path, ...classifyContentPath(path) });
	}
	return changes;
}

// Old blogthedata.com path → root-relative jsolly path for the content a DST
// tree already holds, read back through the same entries (published posts,
// categories, recipe ids, media). rewrite-content uses it for content that
// has no url-map row until C0's url-map-sync.
export function dstLegacyPaths(dst) {
	const found = new Map();
	for (const entry of CONTENT_ENTRIES.filter(({ legacy }) => legacy)) {
		const rests = entry.from.endsWith("/")
			? dstFilesUnder(join(dst, entry.to))
					.filter((rest) => !entry.match || entry.match.test(rest))
					.filter((rest) => !entry.exclude?.includes(rest))
			: [""].filter(() => existsSync(join(dst, entry.to)));
		for (const rest of rests) {
			const read = () => readFileSync(join(dst, `${entry.to}${rest}`), "utf8");
			for (const item of entry.legacy(rest, read)) {
				found.set(item.source, item.destination.slice(JSOLLY_ORIGIN.length));
			}
		}
	}
	return found;
}

function dstFilesUnder(dir) {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir, { recursive: true })
		.filter((relative) => statSync(join(dir, relative)).isFile())
		.map((relative) => relative.split(sep).join("/"));
}
