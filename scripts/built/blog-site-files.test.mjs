import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import it from "node:test";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { postHref } from "../../src/lib/blog/urls.js";
import { securityTxtProblems } from "../security-txt.mjs";
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
const ROBOTS_LINE = /^(?<name>[A-Za-z-]+):\s*(?<value>\S.*)$/u;

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

// robots.txt as { directives: [lowercase name, value] pairs, unparsed: the
// lines that are neither blank, a comment nor a directive }.
function readRobots(text) {
	const robots = { directives: [], unparsed: [] };
	for (const line of text.split("\n")) {
		if (line === "" || line.startsWith("#")) continue;
		if (!ROBOTS_LINE.test(line)) {
			robots.unparsed.push(line);
			continue;
		}
		const { name, value } = ROBOTS_LINE.exec(line).groups;
		robots.directives.push([name.toLowerCase(), value]);
	}
	return robots;
}

it("the sitemap lists every indexable page with post lastmods, robots.txt keeps crawlers off only the blog search, and security.txt is valid", async () => {
	const pages = await builtPages();
	assert.ok(
		pages.noindex.includes(`${SITE}/blog/search/`),
		"the blog search page is noindex",
	);

	const index = await readXml("sitemap-index.xml");
	assert.deepEqual(
		[...index.querySelectorAll("sitemap > loc")].map((loc) => loc.textContent),
		[`${SITE}/sitemap-0.xml`],
		"the sitemap index names the one sitemap",
	);
	const urls = [...(await readXml("sitemap-0.xml")).querySelectorAll("url")];
	const entries = new Map(
		urls.map((url) => [
			url.querySelector("loc").textContent,
			url.querySelector("lastmod")?.textContent ?? null,
		]),
	);
	assert.equal(entries.size, urls.length, "each URL is listed once");
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

	const robots = readRobots(await readFile(join(DIST, "robots.txt"), "utf8"));
	assert.deepEqual(robots.unparsed, [], "every robots.txt line is a directive");
	const directives = (name) =>
		robots.directives
			.filter(([directive]) => directive === name)
			.map(([, value]) => value);
	assert.deepEqual(directives("user-agent"), ["*"]);
	assert.deepEqual(directives("allow"), ["/"]);
	assert.deepEqual(directives("disallow"), ["/blog/search/"]);
	assert.deepEqual(directives("sitemap"), [`${SITE}/sitemap-index.xml`]);
	assert.deepEqual(
		[...entries.keys()].filter((loc) =>
			directives("disallow").some((path) =>
				new URL(loc).pathname.startsWith(path),
			),
		),
		[],
		"no sitemap URL is disallowed",
	);

	const canonical = `${SITE}/.well-known/security.txt`;
	const encryption = `${SITE}/pgp-key.txt`;
	assert.deepEqual(
		securityTxtProblems(
			await readFile(join(DIST, ".well-known", "security.txt"), "utf8"),
			{
				contact: `${SITE}/contact/`,
				encryption,
				"preferred-languages": "en",
				canonical,
			},
		),
		[],
	);
	const missing = await Promise.all(
		[canonical, encryption, `${SITE}/contact/`].map(async (url) => {
			const { pathname } = new URL(url);
			const file = pathname.endsWith("/")
				? join(DIST, pathname, "index.html")
				: join(DIST, pathname);
			return (await exists(file)) ? [] : [url];
		}),
	);
	assert.deepEqual(missing.flat(), [], "security.txt's URLs are built");
});
