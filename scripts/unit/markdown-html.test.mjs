import assert from "node:assert/strict";
import { it } from "vitest";
import { markdownHtmlFacts } from "../built/markdown-html.mjs";

it("Markdown HTML facts preserve article JSON, anchors, destinations and canonical metadata", () => {
	const facts = markdownHtmlFacts(
		`<!doctype html><link rel="RELATED" type="APPLICATION/JSON" href="/recipes/data.json"><link rel="alternate" type="text/markdown" href="/recipe.md"><meta property="og:image" content="/image.webp"><meta property="og:image:alt" content="A &amp; B"><body><h1> Recipe &amp; title </h1><a class="open-button" href="/recipe/">Open</a><article class="article-body"><h2 id="authored">Section</h2><img src="../image.webp"><script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"Writer"}}</script></article>`,
	);
	assert.deepEqual(facts.structured, [
		{ "@type": "BlogPosting", author: { name: "Writer" } },
	]);
	assert.deepEqual(facts.headingIds, ["authored"]);
	assert.deepEqual(facts.articleImages, ["../image.webp"]);
	assert.deepEqual(facts.openLinks, ["/recipe/"]);
	assert.equal(facts.related, "/recipes/data.json");
	assert.equal(facts.alternate, "/recipe.md");
	assert.equal(facts.image, "/image.webp");
	assert.equal(facts.imageAlt, "A & B");
	assert.equal(facts.title, "Recipe & title");
});

it("Markdown HTML facts exclude inert template contents and retain noscript descendants", () => {
	const facts = markdownHtmlFacts(
		`<!doctype html><body><template><h1>Wrong</h1><article class="article-body"><h2 id="inert">Inert</h2></article><script type="application/ld+json">not JSON</script></template><h1>Kept</h1><article class="article-body"><noscript><h3 id="fallback">Fallback</h3><img src="fallback.webp"></noscript></article>`,
	);
	assert.equal(facts.title, "Kept");
	assert.deepEqual(facts.headingIds, ["fallback"]);
	assert.deepEqual(facts.articleImages, ["fallback.webp"]);
	assert.deepEqual(facts.structured, []);
	assert.ok(!facts.bodyText.includes("Wrong"));
	assert.ok(facts.bodyText.includes("Fallback"));
});

it("Markdown search-note facts detect displacement, lost hiding and missing notes", () => {
	const note =
		'<div data-context7-ask aria-hidden="true" class="other sr-only">Search</div>';
	assert.deepEqual(
		markdownHtmlFacts(`<!doctype html><body><!--comment-->${note}<h1>Page</h1>`)
			.note,
		{ hidden: "true", screenReaderOnly: true, firstInBody: true },
	);
	assert.equal(
		markdownHtmlFacts(`<!doctype html><body><p>Earlier</p>${note}`).note
			.firstInBody,
		false,
	);
	const visible = markdownHtmlFacts(
		"<!doctype html><body><div data-context7-ask>Search</div>",
	).note;
	assert.deepEqual(visible, {
		hidden: null,
		screenReaderOnly: false,
		firstInBody: true,
	});
	assert.deepEqual(
		// biome-ignore lint/security/noSecrets: Missing-note HTML fixture, not credential material.
		markdownHtmlFacts("<!doctype html><body><h1>Page</h1>").note,
		{ hidden: null, screenReaderOnly: false, firstInBody: false },
	);
});

it("Markdown JSON-LD matching respects foreign namespaces and rejects malformed matching JSON", () => {
	const facts = markdownHtmlFacts(
		'<!doctype html><svg><script type="APPLICATION/LD+JSON">not JSON</script></svg><script type="APPLICATION/LD+JSON">{"@type":"BlogPosting"}</script>',
	);
	assert.deepEqual(facts.structured, [{ "@type": "BlogPosting" }]);
	assert.throws(
		() =>
			markdownHtmlFacts(
				'<!doctype html><script type="application/ld+json">not JSON</script>',
			),
		SyntaxError,
	);
});
