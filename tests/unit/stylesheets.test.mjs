import assert from "node:assert/strict";
import { it } from "vitest";
import { stylesheets } from "../built/pages.mjs";

it("stylesheet facts retain DOM rel, namespace, missing-href and inert-content semantics", () => {
	assert.deepEqual(
		stylesheets(`
			<link rel="stylesheet" href="/first.css?x=1&amp;y=2">
			<link rel="StyleSheet" href="/case.css">
			<link rel="stylesheet alternate" href="/alternate.css">
			<noscript><link rel="stylesheet" href="/no-script.css"></noscript>
			<template><link rel="stylesheet" href="/template.css"></template>
			<svg><link rel="stylesheet" href="/svg.css" />
				<foreignObject><link rel="stylesheet" href="/html.css"></foreignObject>
			</svg>
			<link rel="stylesheet">
		`),
		["/first.css?x=1&y=2", "/html.css", null],
	);
});
