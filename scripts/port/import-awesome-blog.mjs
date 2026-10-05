// Brings awesome-blog (SRC) files into this repository along the merge plan's
// path map (§1.2, §1.4, §1.6, §1.8), one area at a time:
//
//   node scripts/port/import-awesome-blog.mjs posts categories   # B03
//   node scripts/port/import-awesome-blog.mjs --list             # the map
//   node scripts/port/import-awesome-blog.mjs --resync [<sha>]   # C0
//
// An area import reads SRC at `freeze_sha ?? cut_sha` (scripts/port/source.json)
// and refuses to replace a target that already differs (a step's hand edits)
// unless --overwrite is passed. Code areas are only the starting point: their
// step adapts the files by hand. Files the plan merges or splits (lib
// frontmatter/cards/utils, the global/article-content/motion/no-script styles,
// the astro-contract, browse, search and PWA tests, the privacy page, the root
// configs) have no entry; their step reads them with `git show`.
//
// --resync (C0) re-imports every content file that changed between cut_sha and
// <sha> (default: SRC's local origin/main, which C0 fetches first), applies
// SRC deletions, and records <sha> as freeze_sha. Run rewrite-content.mjs
// afterwards: the re-imported posts are raw SRC again.
//
// Transforms:
// - categories keep PagesCMS's own serialization, JSON.stringify(x, null, 2)
//   with no final newline (plan §1.5), so the first CMS save is a no-op diff;
// - recipe-data rewrites `/media/recipes/` and the old recipe post URL inside
//   JSON string values (§1.6), checked by parse deep-equality, then Biome;
// - the posts' .markdownlint.json is Biome-formatted.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	biomeFormat,
	formatJson,
	git,
	parseCli,
	readSource,
	runCli,
	SOURCE_JSON,
	sourceSha,
	srcBlob,
	srcCommit,
	srcFiles,
	writeDstFile,
} from "./lib.mjs";

// The generated recipe post is dropped (J7); its URL re-homes at /recipes/.
const INSTANT_POT_POST = "15-minute-dump-and-go-instant-pot-recipes.md";
const MARKDOWN_FILE = /^[^/.][^/]*\.md$/u;
const JSON_FILE = /^[^/]+\.json$/u;
const NOT_RECIPE_MEDIA = /^(?!recipes\/)/u;
const RECIPE_MEDIA_PATH = /\/media\/recipes\//gu;
const OLD_RECIPE_POST =
	/\/post\/15-minute-dump-and-go-instant-pot-recipes\/(?=["#?\s]|$)/gu;

// area → { step, content, entries }. An entry whose `from` ends in "/" maps
// every SRC file under that directory (filtered by `match` on the remainder,
// minus `exclude`) to the same remainder under `to`; any other entry is one
// file. `content` areas are the freeze notice's allowlist, which --resync owns.
export const AREAS = {
	posts: {
		step: "B03",
		content: true,
		entries: [
			{
				from: "src/content/posts/",
				to: "src/content/blog/posts/",
				match: MARKDOWN_FILE,
				exclude: [INSTANT_POT_POST],
			},
			// Shell globs skip dotfiles, so the lint config is an explicit entry.
			{
				from: "src/content/posts/.markdownlint.json",
				to: "src/content/blog/posts/.markdownlint.json",
				transform: "biome",
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
				transform: "pagescms-json",
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
				transform: "recipe-json",
			},
			{
				from: "src/components/recipes/nutrition-data.json",
				to: "src/components/recipes/nutrition-data.json",
				transform: "recipe-json",
			},
		],
	},
	"recipe-media": {
		step: "B15",
		content: true,
		entries: [{ from: "public/media/recipes/", to: "public/recipes/media/" }],
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
				to: "src/pages/blog/works-cited/index.astro",
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
				to: "src/pages/blog/all-posts/index.astro",
			},
			{
				from: "src/pages/category/[slug]/index.astro",
				to: "src/pages/blog/category/[slug]/index.astro",
			},
		],
	},
	"blog-post": {
		step: "B08",
		entries: [
			{
				from: "src/pages/post/[slug]/index.astro",
				to: "src/pages/blog/[slug]/index.astro",
			},
		],
	},
	"blog-search": {
		step: "B09",
		entries: [
			{
				from: "src/pages/search/index.astro",
				to: "src/pages/blog/search/index.astro",
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

// Every SRC path at `files` an entry covers, as [from, to] pairs.
function entryPairs(entry, files) {
	if (!entry.from.endsWith("/")) {
		return files.includes(entry.from) ? [[entry.from, entry.to]] : [];
	}
	return files
		.filter((path) => path.startsWith(entry.from))
		.map((path) => path.slice(entry.from.length))
		.filter((rest) => (entry.match ? entry.match.test(rest) : true))
		.filter((rest) => !entry.exclude?.includes(rest))
		.map((rest) => [`${entry.from}${rest}`, `${entry.to}${rest}`]);
}

// The [from, to, entry] mappings of the named areas at one SRC tree. With
// `strict`, an entry matching no SRC file means the map is wrong for this SHA,
// which fails loud; --resync is not strict, since a deleted file exists only in
// the older tree.
function areaMappings(names, files, { strict = true } = {}) {
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
			return pairs.map(([from, to]) => ({ from, to, entry }));
		});
	});
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

// The DST bytes for one SRC file.
function transform(entry, to, blob) {
	if (!entry.transform) {
		return blob;
	}
	const text = blob.toString("utf8");
	if (entry.transform === "biome") {
		return biomeFormat(to, text);
	}
	if (entry.transform === "pagescms-json") {
		return JSON.stringify(JSON.parse(text), null, 2);
	}
	if (entry.transform === "recipe-json") {
		const mapped = mapRecipeStrings(JSON.parse(text));
		const output = formatJson(to, mapped);
		if (!isDeepStrictEqual(JSON.parse(output), mapped)) {
			throw new Error(`${to}: formatted JSON no longer equals the mapped data`);
		}
		return output;
	}
	throw new Error(`unknown transform ${entry.transform}`);
}

function sameBytes(dst, to, content) {
	const target = join(dst, to);
	return (
		existsSync(target) && readFileSync(target).equals(Buffer.from(content))
	);
}

function importAreas({ src, dst, names, overwrite }) {
	const sha = sourceSha(readSource(dst));
	const files = srcFiles(src, sha);
	const outputs = areaMappings(names, files).map(({ from, to, entry }) => ({
		to,
		content: transform(entry, to, srcBlob(src, sha, from)),
	}));
	const changed = outputs.filter(
		({ to, content }) => !sameBytes(dst, to, content),
	);
	const conflicts = changed.filter(({ to }) => existsSync(join(dst, to)));
	if (conflicts.length > 0 && !overwrite) {
		throw new Error(
			`these targets already differ from SRC (a step's own edits?); pass --overwrite to replace them:\n${conflicts.map(({ to }) => `  ${to}`).join("\n")}`,
		);
	}
	for (const { to, content } of changed) {
		writeDstFile(dst, to, content);
	}
	console.log(
		`✓ ${names.join(", ")} from awesome-blog@${sha.slice(0, 10)}: ${outputs.length} files, ${changed.length} written.`,
	);
	return 0;
}

const CONTENT_AREAS = Object.keys(AREAS).filter((name) => AREAS[name].content);

// SRC path → content mapping at one tree.
function contentMappings(files) {
	return new Map(
		areaMappings(CONTENT_AREAS, files, { strict: false }).map((mapping) => [
			mapping.from,
			mapping,
		]),
	);
}

function resync({ src, dst, revision }) {
	const source = readSource(dst);
	const target = srcCommit(src, revision ?? "origin/main");
	const changes = git(src, [
		"diff",
		"--no-renames",
		"--name-status",
		"-z",
		source.cut_sha,
		target,
	]).split("\0");
	const before = contentMappings(srcFiles(src, source.cut_sha));
	const after = contentMappings(srcFiles(src, target));
	const imported = [];
	const removed = [];
	for (let index = 0; index + 1 < changes.length; index += 2) {
		const [status, path] = [changes[index], changes[index + 1]];
		const mapping = (status === "D" ? before : after).get(path);
		if (!mapping) {
			continue;
		}
		if (status === "D") {
			rmSync(join(dst, mapping.to), { force: true });
			removed.push(mapping.to);
		} else {
			writeDstFile(
				dst,
				mapping.to,
				transform(mapping.entry, mapping.to, srcBlob(src, target, path)),
			);
			imported.push(mapping.to);
		}
	}
	writeDstFile(
		dst,
		SOURCE_JSON,
		formatJson(SOURCE_JSON, { ...source, freeze_sha: target }),
	);
	console.log(
		`✓ resynced content ${source.cut_sha.slice(0, 10)}..${target.slice(0, 10)}: ${imported.length} re-imported, ${removed.length} removed; freeze_sha = ${target}.`,
	);
	for (const path of imported) {
		console.log(`  imported ${path}`);
	}
	for (const path of removed) {
		console.warn(
			`  ⚠ removed ${path}: SRC deleted it. Decide its url-map row by hand (plan B00 remedy); the destination test fails until then.`,
		);
	}
	return 0;
}

function list() {
	for (const [name, area] of Object.entries(AREAS)) {
		console.log(`${name} (${area.step}${area.content ? ", content" : ""})`);
		for (const entry of area.entries) {
			console.log(
				`  ${entry.from} -> ${entry.to}${entry.transform ? ` [${entry.transform}]` : ""}`,
			);
		}
	}
	return 0;
}

function main(argv) {
	const options = parseCli(argv, {
		resync: { type: "boolean" },
		overwrite: { type: "boolean" },
		list: { type: "boolean" },
	});
	if (options.list) {
		return list();
	}
	if (options.resync) {
		if (options.positionals.length > 1) {
			throw new Error("--resync takes at most one revision");
		}
		return resync({ ...options, revision: options.positionals[0] });
	}
	if (options.positionals.length === 0) {
		throw new Error(
			"usage: import-awesome-blog.mjs <area>... [--overwrite] | --resync [<sha>] | --list  [--src <awesome-blog>] [--dst <dir>]",
		);
	}
	return importAreas({ ...options, names: options.positionals });
}

runCli(import.meta.url, main);
