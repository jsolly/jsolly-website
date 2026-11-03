// Keep this module node-builtins-only: the no-install report job imports it.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// The pages the axe audit scans. `npm run check:a11y` audits every built HTML
// document (the post-merge and daily `a11y` workflow); `npm run check:a11y:sample`
// audits SAMPLE (PR CI). tests/built/accessibility-sample.test.mjs fails when a
// sampled route stops being a built page or a page template has no sampled route.

const INDEX_HTML = /index\.html$/u;

// Every built HTML document under root as a served route: `/blog/` for
// dist/blog/index.html, `/404.html` for dist/404.html. Vercel's output is skipped.
export async function builtPages(root: string) {
	async function inventory(dir: string): Promise<string[]> {
		const entries = await readdir(dir, { withFileTypes: true });
		const files = await Promise.all(
			entries
				.filter((e) => e.name !== "_vercel")
				.map((e) => {
					const path = join(dir, e.name);
					return e.isDirectory()
						? inventory(path)
						: path.endsWith(".html")
							? [path]
							: [];
				}),
		);
		return files.flat();
	}
	return (await inventory(root)).map(
		(p) => `/${p.slice(root.length + 1).replace(INDEX_HTML, "")}`,
	);
}
