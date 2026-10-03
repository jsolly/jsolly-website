import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import it from "node:test";
import { globby } from "globby";
import { JSDOM } from "jsdom";

const FRAME_DENIED = /frame-ancestors 'none'/u;
const DEFAULT_SELF = /default-src 'self'/u;
const WHITESPACE = /\s+/u;
const SCRIPT_DIRECTIVE = /(?:^|;)\s*script-src\s+(?<sources>[^;]+)/u;
const HEADER_SCRIPT_FALLBACK =
	/(?:^|;)\s*(?:script-src(?:-elem)?|default-src)\s/u;

it("final built pages authorize Astro bootstrap through hashes and retain CSP", async () => {
	const vercel = JSON.parse(await fs.readFile("vercel.json", "utf8"));
	const header = vercel.headers
		.flatMap((entry) => entry.headers)
		.find((entry) => entry.key === "Content-Security-Policy");
	assert.ok(header, "response policy remains present");
	assert.doesNotMatch(
		header.value,
		HEADER_SCRIPT_FALLBACK,
		"Astro owns the per-page script policy; a second header fallback would block its hashes",
	);
	assert.match(
		header.value,
		FRAME_DENIED,
		"framing restriction stays in the response header",
	);
	const pages = await globby("dist/**/*.html");
	assert.ok(pages.length > 0, "built HTML is required");
	const contents = await Promise.all(
		pages.map(async (file) => ({
			file,
			html: await fs.readFile(file, "utf8"),
		})),
	);
	for (const { file, html } of contents) {
		const dom = new JSDOM(html);
		try {
			const meta = dom.window.document.head.querySelector(
				'meta[http-equiv="content-security-policy"]',
			);
			assert.ok(meta, `${file}: policy is in the head`);
			const policy = meta.getAttribute("content");
			assert.match(
				policy,
				DEFAULT_SELF,
				`${file}: default resource restriction`,
			);
			const directive = policy.match(SCRIPT_DIRECTIVE)?.groups?.sources;
			assert.ok(directive, `${file}: script policy exists`);
			assert.ok(
				!directive.includes("'unsafe-inline'") &&
					!directive.includes("'unsafe-eval'"),
				`${file}: arbitrary code stays blocked`,
			);
			for (const script of dom.window.document.querySelectorAll(
				"script:not([src])",
			)) {
				if (
					script.type &&
					!["module", "text/javascript", "application/javascript"].includes(
						script.type,
					)
				)
					continue;
				if (!script.textContent) continue;
				const hash = createHash("sha256")
					.update(script.textContent)
					.digest("base64");
				assert.ok(
					directive.split(WHITESPACE).includes(`'sha256-${hash}'`),
					`${file}: final script bytes are authorized after HTML processing`,
				);
				assert.ok(
					meta.compareDocumentPosition(script) &
						dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
					`${file}: policy precedes scripts`,
				);
			}
		} finally {
			dom.window.close();
		}
	}
});
