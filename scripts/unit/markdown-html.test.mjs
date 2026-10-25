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

it("Markdown search-note facts detect displacement, lost hiding, missing notes and a heading in or as the note", () => {
	const note =
		'<div data-context7-ask aria-hidden="true" class="other sr-only">Search</div>';
	// The note opens the body, so any heading level in its label takes the
	// document's first-heading slot away from the page's own h1.
	const labelled = (label) =>
		markdownHtmlFacts(
			`<!doctype html><body><div data-context7-ask aria-hidden="true" class="sr-only">${label}<p>note</p></div><main><h1>Page</h1><h2>Section</h2></main>`,
		);
	// Every level h1-h6, so narrowing the outline set to the id levels fails
	// here, and one label nested a level deep, so atOrInNote must walk ancestors
	// rather than check the note's direct children.
	for (const [label, heading] of [
		["<h1>Search</h1>", "h1"],
		["<h2>Search</h2>", "h2"],
		["<h4>Search</h4>", "h4"],
		["<h5>Search</h5>", "h5"],
		["<h6>Search</h6>", "h6"],
		// biome-ignore lint/security/noSecrets: Nested HTML label fixture, not credential material.
		["<div><h3>Search</h3></div>", "h3"],
	]) {
		const facts = labelled(label);
		assert.equal(facts.noteHeading, heading, label);
		assert.equal(facts.firstHeading, heading, label);
	}
	// A note element that is itself an h1 is the shape the old ancestors-only
	// walk missed: firstHeading still reads "h1", so atOrInNote counts the note.
	const headingNote = markdownHtmlFacts(
		'<!doctype html><body><h1 data-context7-ask aria-hidden="true" class="sr-only">Search</h1><main><h1>Page</h1></main>',
	);
	assert.equal(headingNote.noteHeading, "h1");
	assert.equal(headingNote.firstHeading, "h1");
	// biome-ignore lint/security/noSecrets: HTML label fixture, not credential material.
	const unheaded = labelled("<strong>Search</strong>");
	assert.equal(unheaded.noteHeading, null);
	assert.equal(unheaded.firstHeading, "h1");
	assert.equal(
		markdownHtmlFacts(
			// biome-ignore lint/security/noSecrets: Heading-free HTML fixture, not credential material.
			"<!doctype html><body><template><h2>Inert</h2></template><p>No headings</p>",
		).firstHeading,
		null,
	);
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
	// biome-ignore lint/security/noSecrets: Missing-note HTML fixture, not credential material.
	const missing = markdownHtmlFacts("<!doctype html><body><h1>Page</h1>");
	assert.deepEqual(missing.note, {
		hidden: null,
		screenReaderOnly: false,
		firstInBody: false,
	});
	// No note means atOrInNote matches nothing: a predicate that read a missing
	// note as "in the note" would report this page's own h1 as displaced.
	assert.equal(missing.noteHeading, null);
	assert.equal(missing.firstHeading, "h1");
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
