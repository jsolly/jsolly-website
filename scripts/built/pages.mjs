// Shared readers for tests over a built dist/ (the real one or a temp copy's).
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
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
