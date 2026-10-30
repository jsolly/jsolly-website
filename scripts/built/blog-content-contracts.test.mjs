import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll as after, beforeAll as before, it } from "vitest";
import { stringify } from "yaml";
import {
	CATEGORIES_DIR,
	DEFAULT_IMAGE,
	POSTS_DIR,
} from "../../src/lib/blog/constants.js";
import { exists, readBuilt, routeManifest } from "./pages.mjs";
import { createTempCopy, requireSuccess } from "./temp-copy.mjs";

// The blog's content contracts, ported from awesome-blog's verify:cms,
// verify:drafts and verify:identities scripts, plus two B14 scenarios (an
// unknown related slug, a CMS image under /blog/media/). Every scenario writes
// posts as PagesCMS would into one temp copy, so the real tree, its dist/ and
// its Astro data store stay untouched (temp-copy.mjs checks the data store).
//
// The positive posts share one production build (`npm run build`, so the
// HTML post-processing and the copy's CSP suite run over them too), and
// before() reads every fact the positive tests check from it straight away.
// Each failure scenario then adds its files, runs `astro build`, which stops
// at its first error, and removes them again.
const SITE = "https://www.jsolly.com";

// awesome-blog scripts/content-files.mjs serializePost, inlined (MST-12).
function serializePost(post) {
	const { body, ...metadata } = post;
	return `---\n${stringify(metadata, { lineWidth: 0, compat: "yaml-1.1" })}---\n\n${body.trim()}\n`;
}

// A post file as hosted PagesCMS writes it: plain unquoted values (timestamps
// included), a list as `- item` lines, and no key for an empty optional field
// (pass it as undefined), then the body.
function cmsSource({ body, ...fields }) {
	const lines = Object.entries(fields)
		.filter(([, value]) => value !== undefined)
		.flatMap(([key, value]) =>
			Array.isArray(value)
				? [`${key}:`, ...value.map((item) => `  - ${item}`)]
				: [`${key}: ${value}`],
		);
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

// awesome-blog verify:cms's post: microsecond timestamps with an offset, and
// no author or image.
const CMS_POST = {
	slug: "cms-contract",
	title: "CMS source compatibility",
	category: "Geodev",
	description: "Test the actual authoring format.",
	draft: false,
	published: "2026-10-02T14:00:23.123456-04:00",
	updated: "2026-10-02T14:00:23.123456-04:00",
	body: "<p>Retain this source.</p>\n\n<pre><code>  keep indentation\n</code></pre>\n",
};

// A CMS upload under /blog/media/, used as the post image and in the body.
const UPLOAD = "/blog/media/cms-upload.webp";
const EMPTY_CATEGORY = "empty-category-contract";

// A draft whose slug, text and update time appear nowhere else. Its update
// time is later than every real post's, so a leak into a feed or a sitemap
// lastmod would show it. It uses SRC's serializePost on purpose, as
// verify:drafts did (plan §1.7).
const DRAFT_SLUG = `draft-contract-${randomUUID()}`;
const DRAFT_SECRET = "draft-contract-private-sentinel-20261002";
const DRAFT_UPDATED = "2030-01-02T03:04:05";
const DRAFT = serializePost({
	slug: DRAFT_SLUG,
	title: DRAFT_SECRET,
	body: `<p>${DRAFT_SECRET}</p>`,
	description: DRAFT_SECRET,
	category: "Geodev",
	draft: true,
	published: "2026-10-02T00:00:00Z",
	updated: `${DRAFT_UPDATED}Z`,
});

// Published, with the upload as its image and in its body, and relating the
// draft: a related draft is no unknown slug, and its card must not render.
const IMAGE_POST = {
	slug: "cms-image-contract",
	title: "CMS image upload",
	category: "Geodev",
	description: "A post whose images are CMS uploads.",
	draft: false,
	image: UPLOAD,
	imageAlt: "An upload",
	published: "2026-10-03T09:00:00Z",
	updated: "2026-10-03T09:00:00Z",
	related: [DRAFT_SLUG],
	body: `<p>Uploaded through the CMS.</p>\n\n<p><img src="${UPLOAD}" alt="An upload"></p>\n`,
};

let copy;
// What the positive build produced, read in before(): { cms, draft, image }.
let built;

// The copy's built page at `path` read with `read` (see pages.mjs readBuilt).
function readCopy(path, read) {
	return readBuilt(path, read, join(copy.dir, "dist"));
}

// Writes `source` as the copy's post `slug`, failing if it exists.
function writePost(slug, source) {
	return writeFile(join(copy.dir, POSTS_DIR, `${slug}.md`), source, {
		flag: "wx",
	});
}

// Every file under `dir` (recursively) whose bytes contain one of `markers`,
// relative to `dir`.
async function filesContaining(dir, markers) {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	const leaks = await Promise.all(
		entries
			.filter((entry) => entry.isFile())
			.map(async (entry) => {
				const file = join(entry.parentPath, entry.name);
				const bytes = await readFile(file);
				return markers.some((marker) => bytes.includes(marker))
					? [file.slice(dir.length + 1)]
					: [];
			}),
	);
	return leaks.flat();
}

function structuredData(document) {
	return [...document.querySelectorAll('script[type="application/ld+json"]')]
		.map((script) => JSON.parse(script.textContent))
		.find((value) => value["@type"] === "BlogPosting");
}

// The CMS post's page: its heading without the heading link, its
// preformatted text, its first time and its JSON-LD author.
function readCmsPost() {
	return readCopy(`blog/${CMS_POST.slug}`, (document) => {
		const heading = document.querySelector("h1").cloneNode(true);
		heading.querySelector(".heading-link")?.remove();
		return {
			heading: heading.textContent,
			code: document.querySelector(".article-body pre code")?.textContent,
			time: document.querySelector("time")?.getAttribute("datetime"),
			author: structuredData(document).author["@id"],
			image: document.querySelector("img.article-hero")?.getAttribute("src"),
		};
	});
}

// Where the draft shows up: the built files carrying it, its route, the route
// manifest, and the related section of the post relating it.
async function readDraft() {
	const dist = join(copy.dir, "dist");
	const routes = await routeManifest(copy.dir);
	return {
		leaks: await filesContaining(
			dist,
			[DRAFT_SLUG, DRAFT_SECRET, DRAFT_UPDATED].map((marker) =>
				Buffer.from(marker),
			),
		),
		routeBuilt: await exists(join(dist, "blog", DRAFT_SLUG)),
		manifestListsPublished: routes.includes(`/blog/${IMAGE_POST.slug}/`),
		manifestDraftRoutes: routes.filter((route) => route.includes(DRAFT_SLUG)),
		relatedSection: await readCopy(
			`blog/${IMAGE_POST.slug}`,
			(document) => document.querySelector(".related-posts") !== null,
		),
	};
}

// Where the upload is referenced: the post's hero, body images, social image
// and JSON-LD image, its archive card, and whether the built file matches it.
async function readImagePost() {
	const page = await readCopy(`blog/${IMAGE_POST.slug}`, (document) => ({
		hero: document.querySelector("img.article-hero")?.getAttribute("src"),
		body: [...document.querySelectorAll(".article-body img")].map((img) =>
			img.getAttribute("src"),
		),
		social: document
			.querySelector('meta[property="og:image"]')
			?.getAttribute("content"),
		structured: structuredData(document).image.url,
	}));
	const card = await readCopy("blog/all-posts", (document) =>
		document
			.querySelector(`a.post-card-link[href="/blog/${IMAGE_POST.slug}/"]`)
			?.closest("article")
			?.querySelector("img")
			?.getAttribute("src"),
	);
	const [builtUpload, upload] = await Promise.all([
		readFile(join(copy.dir, "dist", UPLOAD)),
		readFile(join(copy.dir, "public", UPLOAD)),
	]);
	return { page, card, uploadBuilt: builtUpload.equals(upload) };
}

before(async () => {
	copy = await createTempCopy("content-contracts");
	await writeFile(
		join(copy.dir, CATEGORIES_DIR, `${EMPTY_CATEGORY}.json`),
		JSON.stringify({
			slug: EMPTY_CATEGORY,
			name: "Empty category fixture",
			description: "No published posts.",
		}),
		{ flag: "wx" },
	);
	await writePost(CMS_POST.slug, cmsSource(CMS_POST));
	await writePost(IMAGE_POST.slug, cmsSource(IMAGE_POST));
	await writePost(DRAFT_SLUG, DRAFT);
	await copyFile(
		join(copy.dir, "public", DEFAULT_IMAGE),
		join(copy.dir, "public", UPLOAD),
	);
	requireSuccess(copy.npmRun("build"));
	// Run the real image contract over the existing normal-upload and default
	// cover fixtures, so a migration-only assertion cannot block CMS publishing.
	requireSuccess(
		copy.node(
			"node_modules/vitest/vitest.mjs",
			[
				"run",
				"--cache=false",
				"--config",
				"config/testing/vitest.config.mjs",
				"scripts/built/blog-images.test.mjs",
			],
			{ TEST_SUITE: "built" },
		),
	);
	const [cms, draft, image] = await Promise.all([
		readCmsPost(),
		readDraft(),
		readImagePost(),
	]);
	const emptyCategory = await readCopy(
		`blog/category/${EMPTY_CATEGORY}`,
		(document) => ({
			title: document.querySelector("h1")?.textContent,
			cards: document.querySelectorAll(".post-card").length,
			notice: document
				.querySelector("main")
				.textContent.includes("No posts in this category yet."),
		}),
	);
	built = { cms, draft, image, emptyCategory };
});

after(async () => {
	await copy?.remove();
});

// Writes `files` ({ path relative to the copy: contents }) into the copy, runs
// `astro build` and removes the files again, so the next scenario starts from
// the positive set. Returns the build's { status, output }.
async function failingBuild(files) {
	const paths = Object.keys(files).map((relative) => join(copy.dir, relative));
	try {
		for (const [relative, contents] of Object.entries(files)) {
			// biome-ignore lint/performance/noAwaitInLoops: Fixture writes must not outlive failure cleanup.
			await writeFile(join(copy.dir, relative), contents, { flag: "wx" });
		}
		return copy.astroBuild();
	} finally {
		await Promise.all(paths.map((path) => rm(path, { force: true })));
	}
}

// Builds the CMS post under a fresh slug with `field: invalid`; returns
// { field, invalid, slug, status, output }.
async function timestampBuild(field, invalid) {
	const slug = `timestamp-contract-${randomUUID()}`;
	const source = cmsSource({ ...CMS_POST, slug, [field]: invalid });
	return {
		field,
		invalid,
		slug,
		...(await failingBuild({ [join(POSTS_DIR, `${slug}.md`)]: source })),
	};
}

it("a post saved by PagesCMS builds with its title, preformatted indentation, exact timestamps and the default author intact", () => {
	assert.deepEqual(built.cms, {
		heading: "CMS source compatibility",
		code: "  keep indentation\n",
		time: "2026-10-02T18:00:23.123Z",
		// A post without an author gets the public default.
		author: `${SITE}/#person`,
		image: DEFAULT_IMAGE,
	});
});

it("a draft is in no built file and not in the route manifest, its route does not exist, and the published post relating it shows no card for it", () => {
	assert.deepEqual(built.draft, {
		leaks: [],
		routeBuilt: false,
		manifestListsPublished: true,
		manifestDraftRoutes: [],
		relatedSection: false,
	});
});

it("a CMS image under /blog/media/ is served from jsolly.com as the post image and in the post body", () => {
	assert.deepEqual(built.image, {
		page: {
			hero: UPLOAD,
			body: [UPLOAD],
			social: `${SITE}${UPLOAD}`,
			structured: `${SITE}${UPLOAD}`,
		},
		card: UPLOAD,
		uploadBuilt: true,
	});
});

it("a post saved with a date-only or offset-less published or updated time fails the build, naming the field and the file", async () => {
	// One build per value: a build stops at its first invalid entry. An
	// invalid updated time stops the config load (the sitemap's postLastmods).
	const results = [
		await timestampBuild("published", "2026-10-02"),
		await timestampBuild("published", "2026-10-02T14:00:23"),
		await timestampBuild("updated", "2026-10-02T14:00:23"),
		await timestampBuild("updated", "2026-10-02"),
	];
	for (const { field, invalid, slug, status, output } of results) {
		const label = `${field}: ${invalid}`;
		assert.notEqual(status, 0, `${label} builds`);
		assert.ok(
			output.includes(`${field}: Invalid ISO datetime`),
			`${label}: the error names the field:\n${output}`,
		);
		assert.ok(
			output.includes(`${slug}.md`),
			`${label}: the error names the file:\n${output}`,
		);
	}
});

it("an identical copy of a post under another file name fails the build with Duplicate post slug", async () => {
	const { status, output } = await failingBuild({
		[join(POSTS_DIR, `identity-contract-${randomUUID()}.md`)]:
			cmsSource(CMS_POST),
	});
	assert.notEqual(status, 0, "a duplicate post builds");
	assert.ok(
		output.includes(`Duplicate post slug: ${CMS_POST.slug}`),
		`the error names the slug:\n${output}`,
	);
});

it("an identical copy of a category under another file name fails the build with Duplicate category slug", async () => {
	const { status, output } = await failingBuild({
		[join(CATEGORIES_DIR, `identity-contract-${randomUUID()}.json`)]:
			await readFile(join(copy.dir, CATEGORIES_DIR, "Geodev.json"), "utf8"),
	});
	assert.notEqual(status, 0, "a duplicate category builds");
	assert.ok(
		output.includes("Duplicate category slug: Geodev"),
		`the error names the slug:\n${output}`,
	);
});

it("a post relating a slug that names no post fails the build, naming both", async () => {
	const missing = "15-minute-dump-and-go-instant-pot-recipes";
	const { status, output } = await failingBuild({
		[join(POSTS_DIR, "related-contract.md")]: cmsSource({
			...CMS_POST,
			slug: "related-contract",
			title: "Related to a removed post",
			related: [CMS_POST.slug, missing],
		}),
	});
	assert.notEqual(status, 0, "a post relating an unknown slug builds");
	assert.ok(
		output.includes(`Unknown related post: ${missing} (post related-contract)`),
		`the error names the slug and the post:\n${output}`,
	);
});

it("an active category with no published posts renders its empty state in an isolated fixture", () => {
	assert.deepEqual(built.emptyCategory, {
		title: "Empty category fixture",
		cards: 0,
		notice: true,
	});
});

it("a post cannot use a retired category", async () => {
	const { status, output } = await failingBuild({
		[join(POSTS_DIR, "retired-category-contract.md")]: cmsSource({
			...CMS_POST,
			slug: "retired-category-contract",
			category: "uncategorized",
		}),
	});
	assert.notEqual(status, 0, "a post in a retired category builds");
	assert.ok(
		output.includes(
			"Unknown category: uncategorized (post retired-category-contract)",
		),
		output,
	);
});
