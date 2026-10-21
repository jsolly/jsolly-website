import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { it } from "vitest";
import { postHref } from "../../src/lib/blog/urls.js";
import { fieldLines, fieldValues } from "../site-files.mjs";
import { exists, publishedPosts, robotsMeta } from "./pages.mjs";

// The site files over the built dist/ (plan B11): the sitemap, robots.txt and
// what security.txt points at. Expectations come from the built pages' own
// robots meta and the post frontmatter, never from the config/app/astro.ts
// sitemap options under test, so a /recipes/ page (J12) is expected the
// moment it is built.
const DIST = "dist";
const SITE = "https://www.jsolly.com";
// The one custom (non-page) sitemap entry, from config/app/astro.ts customPages.
const RESUME = `${SITE}/John-Solly-Resume.pdf`;

// The built XML file at `path` under dist/ as a document.
async function readXml(path) {
	const raw = await readFile(join(DIST, path), "utf8");
	const { document } = new JSDOM(raw, { contentType: "application/xml" })
		.window;
	if (document.querySelector("parsererror")) {
		throw new Error(`dist/${path} is not well-formed XML`);
	}
	return document;
}

// Every built page's URL, split by whether its robots meta says noindex.
// dist/404.html and dist/500.html are not index.html pages, so neither is a
// candidate.
async function builtPages() {
	const files = await globby("**/index.html", { cwd: DIST });
	const pages = await Promise.all(
		files.map(async (file) => {
			const dir = dirname(file);
			const robots = (await robotsMeta(dir)) ?? "";
			return {
				url: `${SITE}${dir === "." ? "/" : `/${dir}/`}`,
				noindex: robots
					.split(",")
					.some((token) => token.trim().toLowerCase() === "noindex"),
			};
		}),
	);
	return {
		indexable: pages.filter((page) => !page.noindex).map((page) => page.url),
		noindex: pages.filter((page) => page.noindex).map((page) => page.url),
	};
}

// The sitemap as { chunks: the sitemaps its index names, entries: each URL
// mapped to its lastmod (null when absent), listed: how many <url> entries
// it has }.
async function readSitemap() {
	const index = await readXml("sitemap-index.xml");
	const urls = [...(await readXml("sitemap-0.xml")).querySelectorAll("url")];
	return {
		chunks: [...index.querySelectorAll("sitemap > loc")].map(
			(loc) => loc.textContent,
		),
		entries: new Map(
			urls.map((url) => [
				url.querySelector("loc").textContent,
				url.querySelector("lastmod")?.textContent ?? null,
			]),
		),
		listed: urls.length,
	};
}

it("crawlers find every indexable page in the sitemap, each post with its updated time as lastmod", async () => {
	const pages = await builtPages();
	const { chunks, entries, listed } = await readSitemap();
	assert.deepEqual(
		chunks,
		[`${SITE}/sitemap-0.xml`],
		"the sitemap index names the one sitemap",
	);
	assert.equal(entries.size, listed, "each URL is listed once");
	assert.deepEqual(
		[...entries.keys()].sort(),
		[...pages.indexable, RESUME].sort(),
		"the sitemap lists exactly the indexable built pages and the resume",
	);
	const lastmods = new Map(
		(await publishedPosts()).map((post) => [
			`${SITE}${postHref(post.slug)}`,
			post.updatedAt.toISOString(),
		]),
	);
	assert.ok(lastmods.size > 0, "the snapshot publishes posts");
	assert.deepEqual(
		[...entries].filter(
			([loc, lastmod]) => lastmod !== (lastmods.get(loc) ?? null),
		),
		[],
		"each post's lastmod is its updated time, and no other URL has one",
	);
});

it("crawlers are kept off only the noindex blog search, which the sitemap leaves out", async () => {
	const { fields, unparsed } = fieldLines(
		await readFile(join(DIST, "robots.txt"), "utf8"),
	);
	assert.deepEqual(unparsed, [], "every robots.txt line is a directive");
	assert.deepEqual(fieldValues(fields, "user-agent"), ["*"]);
	assert.deepEqual(fieldValues(fields, "allow"), ["/"]);
	assert.deepEqual(fieldValues(fields, "disallow"), ["/blog/search/"]);
	assert.deepEqual(fieldValues(fields, "sitemap"), [
		`${SITE}/sitemap-index.xml`,
	]);
	assert.ok(
		(await builtPages()).noindex.includes(`${SITE}/blog/search/`),
		"the blog search page is noindex",
	);
	assert.deepEqual(
		[...(await readSitemap()).entries.keys()].filter((loc) =>
			new URL(loc).pathname.startsWith("/blog/search/"),
		),
		[],
		"no sitemap URL is disallowed",
	);
});

// The file checks (valid fields, Expires, both hosts expiring together) are
// in scripts/unit/site-files.test.mjs; this checks what security.txt and the
// legacy /pgp-key.txt redirect (SEC-001) point at is in the build.
it("security researchers reach the security.txt URLs, the contact page and the kept /pgp-key.txt", async () => {
	const missing = await Promise.all(
		[
			`${SITE}/.well-known/security.txt`,
			`${SITE}/contact/`,
			`${SITE}/pgp-key.txt`,
		].map(async (url) => {
			const { pathname } = new URL(url);
			const file = pathname.endsWith("/")
				? join(DIST, pathname, "index.html")
				: join(DIST, pathname);
			return (await exists(file)) ? [] : [url];
		}),
	);
	assert.deepEqual(missing.flat(), [], "each URL is built");
});
