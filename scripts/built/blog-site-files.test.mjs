import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import it from "node:test";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { postHref } from "../../src/lib/blog/urls.js";
import {
	fieldLines,
	fieldValues,
	headCommitDate,
	securityTxtProblems,
} from "../site-files.mjs";
import { exists, publishedPosts, readBuilt } from "./pages.mjs";

// The site files over the built dist/ (plan B11): the sitemap, robots.txt and
// security.txt. Expectations come from the built pages' own robots meta, the
// post frontmatter and RFC 9116, never from the astro.config.ts sitemap
// options under test, so a /recipes/ page (J12) is expected the moment it is
// built.
const DIST = "dist";
const SITE = "https://www.jsolly.com";
// The one custom (non-page) sitemap entry, from astro.config.ts customPages.
const RESUME = `${SITE}/John-Solly-Resume.pdf`;
const LEGACY_SECURITY_TXT = new URL(
	"../../legacy/blogthedata/public/.well-known/security.txt",
	import.meta.url,
);

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
			const robots = await readBuilt(
				dir,
				(document) =>
					[...document.querySelectorAll("meta")].find(
						(meta) => meta.name === "robots",
					)?.content ?? "",
			);
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

it("security researchers find a valid security.txt that expires with the old host's and names no expired key", async () => {
	const canonical = `${SITE}/.well-known/security.txt`;
	const text = await readFile(
		join(DIST, ".well-known", "security.txt"),
		"utf8",
	);
	assert.deepEqual(
		securityTxtProblems(
			text,
			{
				contact: `${SITE}/contact/`,
				"preferred-languages": "en",
				canonical,
			},
			{ committed: headCommitDate() },
		),
		[],
	);
	// public/pgp-key.txt (kept as the legacy /pgp-key.txt redirect's
	// destination) expired on 2023-05-08, so neither host offers Encryption,
	// and one yearly bump moves both Expires together.
	const legacy = fieldLines(await readFile(LEGACY_SECURITY_TXT, "utf8")).fields;
	const { fields } = fieldLines(text);
	assert.deepEqual(fieldValues(fields, "encryption"), []);
	assert.deepEqual(fieldValues(legacy, "encryption"), []);
	assert.deepEqual(
		fieldValues(fields, "expires"),
		fieldValues(legacy, "expires"),
		"both hosts' security.txt expire together",
	);
	const missing = await Promise.all(
		[canonical, `${SITE}/contact/`].map(async (url) => {
			const { pathname } = new URL(url);
			const file = pathname.endsWith("/")
				? join(DIST, pathname, "index.html")
				: join(DIST, pathname);
			return (await exists(file)) ? [] : [url];
		}),
	);
	assert.deepEqual(missing.flat(), [], "security.txt's URLs are built");
});
