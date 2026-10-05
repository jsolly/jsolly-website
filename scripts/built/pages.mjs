// Shared readers and a static server for tests over a built dist/ (the real
// one or a temp copy's).
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { globby } from "globby";
import { JSDOM } from "jsdom";

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
