// Shared readers, a static server and browser helpers for tests over a built
// dist/ (the real one or a temp copy's).
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { globby } from "globby";
import { JSDOM } from "jsdom";
import { parseDocument } from "yaml";

const POSTS = new URL("../../src/content/blog/posts/", import.meta.url);
const CATEGORIES = new URL(
	"../../src/content/blog/categories/",
	import.meta.url,
);
// Blog post cards load their images from the legacy CloudFront host; browser
// tests answer every off-origin request with this stand-in.
const OFF_ORIGIN_IMAGE =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';

export async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
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

// The stylesheets a built page loads with JavaScript on (not its <noscript>).
export function stylesheets(html) {
	const dom = new JSDOM(html);
	try {
		return [...dom.window.document.querySelectorAll("link")]
			.filter((link) => link.rel === "stylesheet" && !link.closest("noscript"))
			.map((link) => link.getAttribute("href"));
	} finally {
		dom.window.close();
	}
}

const CONTENT_TYPES = {
	".css": "text/css",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".woff2": "font/woff2",
};

// Serves `root` on a free local port the way a static host does: a path
// ending in / answers with its index.html, anything missing with a plain 404.
// Resolves to { origin, close }.
export async function serveStatic(root) {
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
				"Content-Type":
					CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
			});
			response.end(body);
		} catch {
			response.writeHead(404, { "Content-Type": "text/plain" });
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

// Fulfills every request a Playwright `context` makes outside `origin` with a
// stand-in image, so a test never waits on (or fails with) a remote host.
export async function stubOffOrigin(context, origin) {
	await context.route(
		(url) => url.origin !== origin,
		(route) =>
			route.fulfill({ contentType: "image/svg+xml", body: OFF_ORIGIN_IMAGE }),
	);
}

// The published posts (draft: false; the schema defaults draft to true) as
// { slug, category }, read from the post frontmatter rather than the build,
// so a test can hold the built pages to them.
export async function publishedPosts() {
	const files = await globby("*.md", { cwd: POSTS });
	const posts = await Promise.all(
		files.map(async (file) => {
			const source = await readFile(new URL(file, POSTS), "utf8");
			// The core schema, as the post loader reads it (post-loader.ts).
			const { rawFrontmatter } = parseFrontmatter(source);
			return parseDocument(rawFrontmatter, { schema: "core" }).toJS();
		}),
	);
	return posts
		.filter((post) => post.draft === false)
		.map(({ slug, category }) => ({ slug, category }));
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
