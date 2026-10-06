import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { exists, readBuilt } from "./pages.mjs";
import { createTempCopy } from "./temp-copy.mjs";

// The blog's content contracts, ported from awesome-blog's verify:cms,
// verify:drafts and verify:identities scripts, plus two B14 scenarios (an
// unknown related slug, a CMS image under /blog/media/). Every scenario writes
// posts as PagesCMS would into one temp copy, so the real tree, its dist/ and
// its Astro data store stay untouched (temp-copy.mjs checks the data store).
//
// The positive posts share one production build (`npm run build`, so the
// HTML post-processing and the copy's CSP suite run over them too). Each
// failure scenario then adds its files, runs `astro build`, which stops at its
// first error, and removes them again. The positive tests read the copy's
// dist/ and come first in this file; the failure builds after them do not read
// it.
const SITE = "https://www.jsolly.com";
const POSTS = "src/content/blog/posts";
const CATEGORIES = "src/content/blog/categories";
const MEDIA = "public/blog/media";
// How the collection schema reports a published time it cannot read.
const INVALID_TIMESTAMP = /published: Invalid ISO datetime/u;

// awesome-blog scripts/content-files.mjs serializePost, inlined (MST-12).
function serializePost(post) {
	const { body, ...metadata } = post;
	return `---\n${stringify(metadata, { lineWidth: 0, compat: "yaml-1.1" })}---\n\n${body.trim()}\n`;
}

// Hosted PagesCMS serialization: unquoted timestamps with microseconds and an
// offset, and no key for an empty optional field (author, image).
const CMS_SLUG = "cms-contract";
const CMS_PUBLISHED = "published: 2026-10-02T14:00:23.123456-04:00";
const CMS_SOURCE = `---
slug: ${CMS_SLUG}
title: CMS source compatibility
category: uncategorized
description: Test the actual authoring format.
draft: false
${CMS_PUBLISHED}
updated: 2026-10-02T14:00:23.123456-04:00
---
<p>Retain this source.</p>

<pre><code>  keep indentation
</code></pre>
`;

// A CMS upload under /blog/media/, used as the post image and in the body.
const UPLOAD = "/blog/media/cms-upload.webp";
const IMAGE_SLUG = "cms-image-contract";

// A draft whose slug, text and update time appear nowhere else. Its update
// time is later than every real post's, so a leak into a feed or a sitemap
// lastmod would show it.
const DRAFT_SLUG = `draft-contract-${randomUUID()}`;
const DRAFT_SECRET = "draft-contract-private-sentinel-20261002";
const DRAFT_UPDATED = "2030-01-02T03:04:05";
const DRAFT = serializePost({
	slug: DRAFT_SLUG,
	title: DRAFT_SECRET,
	body: `<p>${DRAFT_SECRET}</p>`,
	description: DRAFT_SECRET,
	category: "uncategorized",
	draft: true,
	published: "2026-10-02T00:00:00Z",
	updated: `${DRAFT_UPDATED}Z`,
});

// Published, with the upload as its image and in its body, and relating the
// draft: a related draft is no unknown slug, and its card must not render.
const IMAGE_POST = serializePost({
	slug: IMAGE_SLUG,
	title: "CMS image upload",
	body: `<p>Uploaded through the CMS.</p>\n\n<p><img src="${UPLOAD}" alt="An upload"></p>`,
	description: "A post whose images are CMS uploads.",
	category: "uncategorized",
	draft: false,
	image: UPLOAD,
	imageAlt: "An upload",
	published: "2026-10-03T09:00:00Z",
	updated: "2026-10-03T09:00:00Z",
	related: [DRAFT_SLUG],
});

let copy;

function postPath(slug) {
	return join(copy.dir, POSTS, `${slug}.md`);
}

before(async () => {
	copy = await createTempCopy("content-contracts");
	await Promise.all([
		writeFile(postPath(CMS_SLUG), CMS_SOURCE, { flag: "wx" }),
		writeFile(postPath(IMAGE_SLUG), IMAGE_POST, { flag: "wx" }),
		writeFile(postPath(DRAFT_SLUG), DRAFT, { flag: "wx" }),
		copyFile(
			join(copy.dir, MEDIA, "default.webp"),
			join(copy.dir, "public", UPLOAD),
		),
	]);
	const build = copy.npmRun("build");
	if (build.status !== 0) {
		throw new Error(
			`npm run build in ${copy.dir} failed:\n${build.stdout}${build.stderr}`,
		);
	}
});

after(async () => {
	await copy?.remove();
});

// The copy's built page at `path` read with `read` (see pages.mjs readBuilt).
function readCopy(path, read) {
	return readBuilt(path, read, join(copy.dir, "dist"));
}

// Writes `files` ({ path relative to the copy: contents }) into the copy, runs
// `astro build` and removes the files again, so the next scenario starts from
// the positive set. Returns the build's exit status and its combined output.
async function failingBuild(files) {
	const paths = Object.keys(files).map((relative) => join(copy.dir, relative));
	try {
		await Promise.all(
			Object.entries(files).map(([relative, contents]) =>
				writeFile(join(copy.dir, relative), contents, { flag: "wx" }),
			),
		);
		const build = copy.astroBuild();
		if (build.error) throw build.error;
		return { status: build.status, output: `${build.stdout}${build.stderr}` };
	} finally {
		await Promise.all(paths.map((path) => rm(path, { force: true })));
	}
}

// The CMS post under a fresh slug with `published: <invalid>`, as
// { invalid, slug, files } (files as failingBuild takes them).
function timestampPost(invalid) {
	const slug = `timestamp-contract-${randomUUID()}`;
	const source = CMS_SOURCE.replace(
		`slug: ${CMS_SLUG}`,
		`slug: ${slug}`,
	).replace(CMS_PUBLISHED, `published: ${invalid}`);
	return { invalid, slug, files: { [join(POSTS, `${slug}.md`)]: source } };
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

it("a post saved by PagesCMS builds with its title, preformatted indentation, exact timestamps and the default author intact", async () => {
	const page = await readCopy(`blog/${CMS_SLUG}`, (document) => {
		const heading = document.querySelector("h1").cloneNode(true);
		heading.querySelector(".heading-link")?.remove();
		return {
			heading: heading.textContent,
			code: document.querySelector(".article-body pre code")?.textContent,
			time: document.querySelector("time")?.getAttribute("datetime"),
			structured: JSON.parse(
				document.querySelector('script[type="application/ld+json"]')
					.textContent,
			),
		};
	});
	assert.equal(page.heading, "CMS source compatibility");
	assert.equal(page.code, "  keep indentation\n");
	assert.equal(page.time, "2026-10-02T18:00:23.123Z");
	assert.equal(
		page.structured.author.name,
		"John Solly",
		"a post without an author gets the public default",
	);
});

it("a draft is in no built file and not in the route manifest, its route does not exist, and the published post relating it shows no card for it", async () => {
	const dist = join(copy.dir, "dist");
	assert.deepEqual(
		await filesContaining(
			dist,
			[DRAFT_SLUG, DRAFT_SECRET, DRAFT_UPDATED].map((marker) =>
				Buffer.from(marker),
			),
		),
		[],
		"built files carrying the draft's slug, text or update time",
	);
	assert.equal(await exists(join(dist, "blog", DRAFT_SLUG)), false);
	const manifest = pathToFileURL(
		join(copy.dir, "src/generated/route-manifest.js"),
	);
	const { routes } = await import(manifest.href);
	assert.ok(
		routes.includes(`/blog/${IMAGE_SLUG}/`),
		"the manifest lists the published CMS posts",
	);
	assert.deepEqual(
		routes.filter((route) => route.includes(DRAFT_SLUG)),
		[],
		"route manifest entries for the draft",
	);
	assert.equal(
		await readCopy(`blog/${IMAGE_SLUG}`, (document) =>
			document.querySelector(".related-posts"),
		),
		null,
		"the related draft renders no related section",
	);
});

it("a CMS image under /blog/media/ is served from jsolly.com as the post image and in the post body", async () => {
	const page = await readCopy(`blog/${IMAGE_SLUG}`, (document) => ({
		hero: document.querySelector("img.article-hero")?.getAttribute("src"),
		body: [...document.querySelectorAll(".article-body img")].map((img) =>
			img.getAttribute("src"),
		),
		social: document
			.querySelector('meta[property="og:image"]')
			?.getAttribute("content"),
		structured: JSON.parse(
			document.querySelector('script[type="application/ld+json"]').textContent,
		).image,
	}));
	assert.deepEqual(page, {
		hero: UPLOAD,
		body: [UPLOAD],
		social: `${SITE}${UPLOAD}`,
		structured: `${SITE}${UPLOAD}`,
	});
	const card = await readCopy("blog/all-posts", (document) =>
		document
			.querySelector(`a.post-card-link[href="/blog/${IMAGE_SLUG}/"]`)
			?.closest("article")
			?.querySelector("img")
			?.getAttribute("src"),
	);
	assert.equal(card, UPLOAD, "the archive card shows the upload");
	assert.deepEqual(
		await readFile(join(copy.dir, "dist", UPLOAD)),
		await readFile(join(copy.dir, "public", UPLOAD)),
		"the upload is built at its path",
	);
});

it("a post saved with a date-only or offset-less published time fails the build, naming the field and the file", async () => {
	// One build per value: a build stops at its first invalid entry.
	const [dateOnly, offsetLess] = ["2026-10-02", "2026-10-02T14:00:23"].map(
		timestampPost,
	);
	const results = [
		{ ...dateOnly, ...(await failingBuild(dateOnly.files)) },
		{ ...offsetLess, ...(await failingBuild(offsetLess.files)) },
	];
	for (const { invalid, slug, status, output } of results) {
		assert.notEqual(status, 0, `published: ${invalid} builds`);
		assert.match(output, INVALID_TIMESTAMP, invalid);
		assert.ok(output.includes(slug), `the error names ${slug}:\n${output}`);
	}
});

it("an identical copy of a post under another file name fails the build with Duplicate post slug", async () => {
	const { status, output } = await failingBuild({
		[join(POSTS, `identity-contract-${randomUUID()}.md`)]: CMS_SOURCE,
	});
	assert.notEqual(status, 0, "a duplicate post builds");
	assert.ok(
		output.includes(`Duplicate post slug: ${CMS_SLUG}`),
		`the error names the slug:\n${output}`,
	);
});

it("an identical copy of a category under another file name fails the build with Duplicate category slug", async () => {
	const { status, output } = await failingBuild({
		[join(CATEGORIES, `identity-contract-${randomUUID()}.json`)]:
			await readFile(join(copy.dir, CATEGORIES, "uncategorized.json"), "utf8"),
	});
	assert.notEqual(status, 0, "a duplicate category builds");
	assert.ok(
		output.includes("Duplicate category slug: uncategorized"),
		`the error names the slug:\n${output}`,
	);
});

it("a post relating a slug that names no post fails the build, naming both", async () => {
	const missing = "15-minute-dump-and-go-instant-pot-recipes";
	const { status, output } = await failingBuild({
		[join(POSTS, "related-contract.md")]: serializePost({
			slug: "related-contract",
			title: "Related to a removed post",
			body: "<p>Points at a post that is gone.</p>",
			description: "Relates a removed post.",
			category: "uncategorized",
			draft: false,
			published: "2026-10-04T09:00:00Z",
			updated: "2026-10-04T09:00:00Z",
			related: [CMS_SLUG, missing],
		}),
	});
	assert.notEqual(status, 0, "a post relating an unknown slug builds");
	assert.ok(
		output.includes(`Unknown related post: ${missing} (post related-contract)`),
		`the error names the slug and the post:\n${output}`,
	);
});
