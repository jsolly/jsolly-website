import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseFrontmatter } from "astro/markdown";
import { articleHtml, headingId, plainText } from "./html.js";
import { parsePost } from "./post-loader.js";
import { postSchema } from "./schemas.js";

const POSTS = new URL("../../content/blog/posts/", import.meta.url);

describe("articleHtml", () => {
	it("Article rendering preserves legacy fragments", () => {
		assert.equal(
			plainText("<p>A &amp; B &#x27;quoted&#x27;</p>"),
			"A & B 'quoted'",
		);
		assert.equal(
			headingId(plainText("<h2>A &amp; B: Example</h2>")),
			"a--b-example",
		);
		assert.match(
			articleHtml("<h2>A &amp; B: Example</h2>"),
			/id="a--b-example"/u,
		);
		// The "#" link is named after its heading, escaped for the attribute;
		// a heading without text keeps a generic name.
		assert.match(
			articleHtml('<h2>A &amp; "B"</h2>'),
			/aria-label="Link to &quot;A &amp; &quot;B&quot;&quot;"/u,
		);
		assert.match(
			articleHtml('<h2><img src="/blog/media/x.webp" alt=""></h2>'),
			/aria-label="Link to this heading"/u,
		);
		const authoredIds = articleHtml(
			// biome-ignore lint/security/noSecrets: an HTML fixture, not credential material.
			'<p id="terms">Intro paragraph</p><p id="kept">Independent anchor</p><h2 id="Intro">Introduction</h2><h2 id="terms">Intro</h2><h2 id="terms">Terms</h2>',
		);
		assert.match(authoredIds, /id="introduction"/u);
		assert.match(authoredIds, /id="intro"/u);
		assert.equal([...authoredIds.matchAll(/id="terms"/gu)].length, 1);
		assert.match(authoredIds, /<p id="kept">/u);
		assert.doesNotMatch(authoredIds, /<p id="terms">/u);
		assert.equal([...authoredIds.matchAll(/class="heading-link"/gu)].length, 3);
	});

	it("Article rendering strips executable authored HTML", () => {
		const rendered = articleHtml(
			// biome-ignore lint/security/noSecrets: an HTML fixture, not credential material.
			'<script>alert(1)</script><img src="post_imgs/test.webp" onerror="alert(2)"><a href="javascript:alert(3)">bad</a><iframe src="https://evil.example/test"></iframe><iframe src="https://www.youtube.com/embed/example"></iframe><table><tr><td>kept</td></tr></table>',
		);
		assert.match(rendered, /<table>/u);
		assert.match(rendered, /youtube\.com\/embed/u);
		assert.doesNotMatch(rendered, /<script|onerror|javascript:|evil\.example/u);
	});

	it("A table of contents follows headings whose authored ids are regenerated", () => {
		// web3-notes-personal-reference.md: the authored ids keep a typo and
		// characters the generated slug drops.
		const rendered = articleHtml(
			'<ol><li><a href="#on-chain/off-chain">On-chain</a></li><li><a href="#kept">Kept</a></li></ol><h3 id="on-chain/off-chain">On-chain/off-chain</h3><p id="kept">Kept</p>',
		);
		assert.match(rendered, /<a href="#on-chainoff-chain" rel=/u);
		assert.match(rendered, /<h3 id="on-chainoff-chain">/u);
		assert.match(rendered, /<a href="#kept" rel=/u);
		assert.doesNotMatch(rendered, /on-chain\/off-chain"/u);
	});

	it("Image sources stay as authored unless they are bare legacy upload paths", () => {
		const rendered = articleHtml(
			[
				'<img src="/blog/media/upload.webp">',
				'<img src="">',
				'<img src="default.webp">',
				'<img src="http://example.com/x.jpg">',
				'<img src="/images/x.jpg">',
				'<img src="post_imgs/test.webp">',
				'<img src="mediafiles/x.webp">',
			].join(""),
		);
		const sources = [...rendered.matchAll(/src="(?<src>[^"]*)"/gu)].map(
			(match) => match.groups?.src,
		);
		assert.deepEqual(sources, [
			"/blog/media/upload.webp",
			"/blog/media/default.webp",
			"/blog/media/default.webp",
			"http://example.com/x.jpg",
			"/images/x.jpg",
			"https://d1d7p8ufhgz4ld.cloudfront.net/media/post_imgs/test.webp",
			"https://d1d7p8ufhgz4ld.cloudfront.net/media/x.webp",
		]);
		assert.doesNotMatch(rendered, /cloudfront\.net\/media\/blog\/media/u);
	});

	it("Authored inline styles keep the allowed declarations and lose the rest", () => {
		const rendered = articleHtml(
			[
				'<h2 style="margin-left:0px;">Twitter</h2>',
				'<ul style="list-style-type:disc;"><li style="list-style-type:disc;">Item</li></ul>',
				// biome-ignore lint/security/noSecrets: an HTML fixture, not credential material.
				'<p style="position:fixed;background-image:url(https://evil.example/x.png)">Overlay</p>',
			].join(""),
		);
		assert.match(rendered, /<h2 style="margin-left:0px" id="twitter">/u);
		assert.match(rendered, /<li style="list-style-type:disc">/u);
		assert.match(rendered, /<p>Overlay<\/p>/u);
		assert.doesNotMatch(rendered, /position:fixed|background-image/u);
	});

	it("Authored links never hand the opened page a window.opener", () => {
		assert.match(
			articleHtml('<a href="https://example.com/" rel="opener">Example</a>'),
			/<a href="https:\/\/example\.com\/" rel="noopener noreferrer">/u,
		);
	});

	it("An untitled embed gets a default accessible title", () => {
		assert.match(
			articleHtml(
				'<iframe src="https://www.youtube.com/embed/example"></iframe>',
			),
			/<iframe src="https:\/\/www\.youtube\.com\/embed\/example" title="Embedded article content" loading="lazy">/u,
		);
	});

	it("Every post renders with unique ids, no executable markup and all its h2 and h3 headings", () => {
		const files = readdirSync(POSTS).filter((name) => name.endsWith(".md"));
		assert.equal(files.length, 105);
		for (const name of files) {
			const source = readFileSync(new URL(name, POSTS), "utf8");
			postSchema.parse(parsePost(source));
			const body = parseFrontmatter(source).content.trim();
			const rendered = articleHtml(body);
			const ids = [
				...rendered.matchAll(/<[a-z][^>]*\sid="(?<id>[^"]*)"/gu),
			].map((match) => match.groups?.id);
			assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ids`);
			assert.doesNotMatch(rendered, /<script/iu, name);
			assert.doesNotMatch(rendered, /<[^>]*\son[a-z]+=/iu, name);
			assert.doesNotMatch(rendered, /javascript:/iu, name);
			assert.equal(
				rendered.match(/<h[23][\s>]/gu)?.length,
				body.match(/<h[23][\s>]/gu)?.length,
				`${name}: headings`,
			);
		}
	});
});
