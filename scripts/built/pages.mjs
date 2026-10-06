// Shared readers, a static server and browser helpers for tests over a built
// dist/ (the real one or a temp copy's).
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "astro/markdown";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { parseDocument } from "yaml";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const POSTS = new URL("../../src/content/blog/posts/", import.meta.url);
const CATEGORIES = new URL(
	"../../src/content/blog/categories/",
	import.meta.url,
);
// Blog posts load their images from the legacy CloudFront host and embed
// third-party frames; browser tests answer every off-origin request with
// these stand-ins.
const OFF_ORIGIN_IMAGE =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';
const OFF_ORIGIN_DOCUMENT = "<!doctype html><title>stand-in</title>";

export async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

// The routes in the route manifest the last build of the project at `root`
// (this checkout, or a temp copy's directory) wrote: the list middleware.ts
// ships.
export async function routeManifest(root = ROOT) {
	const manifest = pathToFileURL(join(root, "src/generated/route-manifest.js"));
	const { routes } = await import(manifest.href);
	return routes;
}

// Every built HTML page under `root`, as { file (relative to root), html }.
export async function readBuiltPages(root = "dist") {
	const files = await globby("**/*.html", { cwd: root });
	return Promise.all(
		files
			.sort((a, b) => a.localeCompare(b, "en"))
			.map(async (file) => ({
				file,
				html: await readFile(join(root, file), "utf8"),
			})),
	);
}

// Parses `html` and returns `read(document)`, closing the DOM afterwards.
function readHtml(html, read) {
	const dom = new JSDOM(html);
	try {
		return read(dom.window.document);
	} finally {
		dom.window.close();
	}
}

// Reads the built page at `path` (a directory such as "blog/all-posts" or
// "/blog/<slug>/", served as its index.html) under `root` with `read`.
export async function readBuilt(path, read, root = "dist") {
	return readHtml(await readFile(join(root, path, "index.html"), "utf8"), read);
}

// The robots meta content of the built page at `path` (as readBuilt takes
// it), or null when the page has none.
export function robotsMeta(path, root = "dist") {
	return readBuilt(
		path,
		(document) =>
			[...document.querySelectorAll("meta")].find(
				(meta) => meta.name === "robots",
			)?.content ?? null,
		root,
	);
}

// The stylesheets a built page loads with JavaScript on (not its <noscript>).
export function stylesheets(html) {
	return readHtml(html, (document) =>
		[...document.querySelectorAll("link")]
			.filter((link) => link.rel === "stylesheet" && !link.closest("noscript"))
			.map((link) => link.getAttribute("href")),
	);
}

const CONTENT_TYPES = {
	".css": "text/css",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript",
	".json": "application/json",
	".md": "text/markdown; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webmanifest": "application/manifest+json",
	".webp": "image/webp",
	".woff2": "font/woff2",
};

// Serves `root` on a free local port the way a static host does: a path
// ending in / answers with its index.html, anything missing with a plain 404.
// `headers` go on every response, as vercel.json's do. Resolves to
// { origin, close }.
export async function serveStatic(root, headers = {}) {
	const server = createServer(async (request, response) => {
		const { pathname } = new URL(request.url, "http://localhost");
		// normalize() resolves "..", so the absolute path never leaves root.
		const relative = normalize(decodeURIComponent(pathname));
		const file = join(
			root,
			relative.endsWith("/") ? `${relative}index.html` : relative,
		);
		try {
			const body = await readFile(file);
			response.writeHead(200, {
				...headers,
				"Content-Type":
					CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
			});
			response.end(body);
		} catch {
			response.writeHead(404, { ...headers, "Content-Type": "text/plain" });
			response.end("not found");
		}
	});
	await new Promise((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	return {
		origin: `http://127.0.0.1:${server.address().port}`,
		close: () =>
			new Promise((resolveClose) => {
				server.closeAllConnections();
				server.close(() => resolveClose());
			}),
	};
}

// Collects what `page` logs to the console with one of `types`, and every
// uncaught page error, into the array it returns, which grows as they happen.
export function collectErrors(page, types = ["error"]) {
	const errors = [];
	page.on("console", (message) => {
		if (types.includes(message.type())) errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(String(error)));
	return errors;
}

// Fulfills every request a Playwright `context` makes outside `origin` with a
// stand-in (an empty HTML document for frames, an image otherwise), so a test
// never waits on (or fails with) a remote host. Resolves to the Set of hosts
// requested so far, which grows as the context makes requests.
export async function stubOffOrigin(context, origin) {
	const hosts = new Set();
	await context.route(
		(url) => url.origin !== origin,
		(route) => {
			const request = route.request();
			hosts.add(new URL(request.url()).host);
			return route.fulfill(
				request.resourceType() === "document"
					? { contentType: "text/html", body: OFF_ORIGIN_DOCUMENT }
					: { contentType: "image/svg+xml", body: OFF_ORIGIN_IMAGE },
			);
		},
	);
	return hosts;
}

// Every post as { slug, category, published, related, title, description,
// feedAuthor, publishedAt, updatedAt }, read from the post frontmatter rather
// than the build, so a test can hold the built pages to it. Only draft: false
// publishes (`published`); the schema defaults draft to true. publishedAt and
// updatedAt are the frontmatter timestamps as Dates.
export async function allPosts() {
	const files = await globby("*.md", { cwd: POSTS });
	return Promise.all(
		files.map(async (file) => {
			const source = await readFile(new URL(file, POSTS), "utf8");
			// The core schema, as the post loader reads it (post-loader.ts).
			const { rawFrontmatter } = parseFrontmatter(source);
			const {
				slug,
				category,
				draft,
				related = [],
				title,
				description,
				feedAuthor = "John_Solly",
				published,
				updated,
			} = parseDocument(rawFrontmatter, { schema: "core" }).toJS();
			return {
				slug,
				category,
				published: draft === false,
				related,
				title,
				description,
				feedAuthor,
				publishedAt: new Date(published),
				updatedAt: new Date(updated),
			};
		}),
	);
}

// The published posts, as allPosts() entries.
export async function publishedPosts() {
	return (await allPosts()).filter((post) => post.published);
}

// Every category slug, read from the category files.
export async function categorySlugs() {
	const files = await globby("*.json", { cwd: CATEGORIES });
	return Promise.all(
		files.map(
			async (file) =>
				JSON.parse(await readFile(new URL(file, CATEGORIES), "utf8")).slug,
		),
	);
}
