import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import {
	PWA_FILES_PATH,
	PWA_NAME,
	PWA_THEME_COLOR,
	RECIPES_PATH,
} from "../../src/components/recipes/constants.mjs";
import data from "../../src/components/recipes/recipe-data.server.mjs";
import {
	drift,
	generate,
} from "../../src/components/recipes/tools/sync-assistant-data.mjs";

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));
const MEDIA_PREFIX = "/recipes/media/";
const CANDIDATE_SEPARATOR = /,\s*/u;
const WHITESPACE = /\s+/u;
const HEADING = /^(?<marks>#+) (?<text>.*)$/u;

// Every image URL a recipe names: src and cardSrc, plus the URL (the first
// token) of each srcset candidate.
function imageUrls(image) {
	const candidates = [image.cardSrcset, image.detailSrcset].flatMap((srcset) =>
		srcset
			.trim()
			.split(CANDIDATE_SEPARATOR)
			.map((candidate) => candidate.split(WHITESPACE)[0]),
	);
	return [image.src, image.cardSrc, ...candidates];
}

it("every recipe image URL is a /recipes/media/ file that exists under public/recipes/media", () => {
	const missingImage = data.recipes
		.filter((recipe) => typeof recipe.image !== "object" || !recipe.image)
		.map((recipe) => recipe.id);
	assert.deepEqual(missingImage, [], "every recipe has an image");
	const urls = data.recipes.flatMap((recipe) =>
		imageUrls(recipe.image).map((url) => ({ id: recipe.id, url })),
	);
	assert.ok(urls.length >= data.recipes.length * 4);
	const outside = urls.filter(({ url }) => !url?.startsWith(MEDIA_PREFIX));
	assert.deepEqual(outside, [], "recipe images outside /recipes/media/");
	const missing = urls.filter(
		({ url }) =>
			url?.startsWith(MEDIA_PREFIX) && !existsSync(join(PUBLIC, url)),
	);
	assert.deepEqual(missing, [], "referenced recipe media are missing");
});

it("the public Markdown library has one title, one ## section per recipe in order and ### sections", () => {
	const markdown = generate().get("recipe-library.md");
	const headings = markdown
		.split("\n")
		.filter((line) => HEADING.test(line))
		.map((line) => HEADING.exec(line).groups);
	assert.deepEqual(
		headings.filter(({ marks }) => marks === "#").map(({ text }) => text),
		["Keto meals & smoothies recipe library"],
	);
	assert.deepEqual(
		headings.filter(({ marks }) => marks === "##").map(({ text }) => text),
		data.recipes.map((recipe) => recipe.title),
	);
	assert.ok(
		headings.filter(({ marks }) => marks === "###").length >=
			data.recipes.length,
		"each recipe has ### sections",
	);
	assert.deepEqual(
		headings.filter(({ marks }) => marks.length > 3).map(({ text }) => text),
		[],
		"recipe sections sit at ### level",
	);
	assert.equal(
		markdown.split("\n---\n").length - 1,
		data.recipes.length - 1,
		"one --- separator between consecutive recipes",
	);
});

it("recipes:check reports an edited and a missing assistant download as drift", async () => {
	const dir = await mkdtemp(join(tmpdir(), "recipe-data-"));
	try {
		const files = [...generate()];
		for (const [name, content] of files) {
			// biome-ignore lint/performance/noAwaitInLoops: Fixture writes must not outlive failure cleanup.
			await writeFile(join(dir, name), content);
		}
		assert.deepEqual(await drift(dir), [], "fresh output has no drift");
		const [[jsonName], [markdownName, markdown]] = files;
		await writeFile(join(dir, markdownName), `${markdown}edited\n`);
		assert.deepEqual(await drift(dir), [markdownName]);
		await rm(join(dir, jsonName));
		assert.deepEqual(await drift(dir), [jsonName, markdownName]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("the published keto collection has 136 meals and 4 smoothies", () => {
	for (const recipe of data.recipes)
		assert.equal(
			Object.hasOwn(recipe, "group"),
			false,
			`${recipe.id}: static dietary groups are retired`,
		);
	const counts = Object.groupBy(data.recipes, (recipe) => recipe.type);
	assert.deepEqual(
		Object.fromEntries(
			Object.entries(counts).map(([type, recipes]) => [type, recipes.length]),
		),
		{ meal: 136, smoothie: 4 },
	);
});

// RecipeLayout's head tags take the app's name and theme colour from
// constants.mjs; the static manifest must say the same, scoped to /recipes/,
// with icons that exist under PWA_FILES_PATH.
it("the recipe app manifest agrees with the constants RecipeLayout uses", async () => {
	const manifest = JSON.parse(
		await readFile(
			join(PUBLIC, PWA_FILES_PATH, "manifest.webmanifest"),
			"utf8",
		),
	);
	assert.equal(manifest.name, PWA_NAME);
	assert.equal(manifest.short_name, PWA_NAME);
	assert.equal(manifest.theme_color, PWA_THEME_COLOR);
	assert.equal(manifest.id, RECIPES_PATH);
	assert.equal(manifest.start_url, RECIPES_PATH);
	assert.equal(manifest.scope, RECIPES_PATH);
	assert.ok(manifest.icons.length > 0, "the manifest lists icons");
	for (const { src } of manifest.icons) {
		assert.ok(
			src.startsWith(PWA_FILES_PATH),
			`${src} is under ${PWA_FILES_PATH}`,
		);
		assert.ok(existsSync(join(PUBLIC, src)), `public${src} exists`);
	}
});
