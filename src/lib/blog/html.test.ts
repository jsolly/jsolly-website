import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { articleHtml, headingId, plainText } from "./html.js";

describe("articleHtml", () => {
	it("article rendering preserves legacy fragments and strips executable authored HTML", () => {
		assert.equal(
			plainText("<p>A &amp; B &#x27;quoted&#x27;</p>"),
			"A & B 'quoted'",
		);
		assert.equal(
			headingId(plainText("<h2>A &amp; B: Example</h2>")),
			"a--b-example",
		);
		const rendered = articleHtml(
			// biome-ignore lint/security/noSecrets: an HTML fixture, not credential material.
			'<h2>A &amp; B: Example</h2><script>alert(1)</script><img src="post_imgs/test.webp" onerror="alert(2)"><a href="javascript:alert(3)">bad</a><iframe src="https://evil.example/test"></iframe><iframe src="https://www.youtube.com/embed/example"></iframe><table><tr><td>kept</td></tr></table>',
		);
		assert.match(rendered, /id="a--b-example"/u);
		assert.match(rendered, /cloudfront\.net\/media\/post_imgs\/test.webp/u);
		assert.match(rendered, /<table>/u);
		assert.match(rendered, /youtube\.com\/embed/u);
		assert.doesNotMatch(rendered, /<script|onerror|javascript:|evil\.example/u);
		const images = articleHtml(
			'<img src="/blog/media/upload.webp"><img src=""><img src="http://example.com/x.jpg"><img src="/images/x.jpg">',
		);
		assert.match(images, /src="\/blog\/media\/upload\.webp"/u);
		assert.match(images, /src="\/blog\/media\/default\.webp"/u);
		assert.match(images, /src="http:\/\/example\.com\/x\.jpg"/u);
		assert.match(images, /src="\/images\/x\.jpg"/u);
		assert.doesNotMatch(images, /cloudfront\.net\/media\/blog\/media/u);
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
});
