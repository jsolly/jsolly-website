import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToRegexp } from "@vercel/routing-utils";
import ts from "typescript";
import { describe, it } from "vitest";
import { shouldNegotiate } from "../../src/lib/accept-negotiate.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const source = ts.createSourceFile(
	"middleware.ts",
	readFileSync(resolve(ROOT, "middleware.ts"), "utf8"),
	ts.ScriptTarget.Latest,
	true,
);
// Read the exported literal without importing the generated route manifest or
// executing middleware. Computed config would be invisible to Vercel's parser.
const statement = source.statements.find(
	(node) =>
		ts.isVariableStatement(node) &&
		node.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		) &&
		node.declarationList.declarations.some(
			(entry) => entry.name.getText(source) === "config",
		),
);
if (!statement || !ts.isVariableStatement(statement)) {
	throw new Error("middleware must export a literal config");
}
const declaration = statement.declarationList.declarations.find(
	(node) => node.name.getText(source) === "config",
);
if (
	!declaration?.initializer ||
	!ts.isObjectLiteralExpression(declaration.initializer)
) {
	throw new Error("middleware config must be an object literal");
}
const property = declaration.initializer.properties.find(
	(node) => node.name?.getText(source) === "matcher",
);
if (
	!property ||
	!ts.isPropertyAssignment(property) ||
	!ts.isArrayLiteralExpression(property.initializer)
) {
	throw new Error("middleware matcher must be an array literal");
}
const patterns = property.initializer.elements.map((node) => {
	if (!ts.isStringLiteral(node)) {
		throw new Error("matcher entries must be literal strings");
	}
	return node.text;
});
if (patterns.length === 0)
	throw new Error("middleware matcher must not be empty");
// Match the installed Vercel Node builder: getRegExpFromMatchers joins each
// pathToRegexp().source and constructs a new RegExp without preserving flags.
// biome-ignore lint/nursery/useUnicodeRegex: reproduce Vercel getRegExpFromMatchers exactly, including flag loss.
const matcher = new RegExp(
	patterns
		.map((pattern) => pathToRegexp("middleware-matcher-test", pattern).source)
		.join("|"),
);

describe("middleware invocation matcher", () => {
	it("keeps pages, explicit Markdown and extensionless misses in scope", () => {
		for (const path of [
			"/",
			"/about/",
			"/about.md",
			"/about.MD",
			"/about.md/",
			"/blog/",
			"/blog/Real-Post/",
			"/blog/Real-Post.md",
			"/blog/category/uncategorized/",
			"/recipes/retired-recipe/",
			"/recipes/meals/",
			"/recipes/smoothies/",
			"/recipes/meals.md",
			"/recipes/data/nope/",
			"/recipes/data/",
			"/no-such-page",
			"/no-such-page.md",
			"/blog/caf%C3%A9/",
			"/blog/c%2B%2B/",
			"/blog/%E0%A4%A/",
		]) {
			assert.equal(matcher.test(path), true, path);
		}
	});

	it("does not invoke middleware for API, data files, or static resources", () => {
		for (const path of [
			"/api/recipe-browse/",
			"/api/other.md",
			"/_astro/chunk.js",
			"/_astro/notes.md",
			"/images/notes.md",
			"/scripts/notes.md",
			"/favicons/notes.md",
			"/recipes/data/recipe-library.md",
			"/recipes/data/recipe-library.md/",
			"/recipes/data/recipe.json",
			"/recipes/media/chicken-960.webp",
			"/recipes/service-worker.js",
			"/recipes/pwa/manifest.webmanifest",
			"/blog/rss.xml",
			"/blog/atom.xml",
			"/blog/media/hero.png",
			"/release.json",
			"/sitemap-index.xml",
			"/.well-known/security.txt",
			"/llms.txt",
			"/robots.txt",
		]) {
			assert.equal(matcher.test(path), false, path);
		}
	});

	it("agrees with the negotiation boundary across path and extension variants", () => {
		for (const prefix of [
			"/",
			"/blog/",
			"/recipes/",
			"/recipes/data/",
			"/api/",
			"/_astro/",
			"/images/",
			"/scripts/",
			"/favicons/",
			"/API/",
			"/apiculture/",
		]) {
			for (const name of [
				"",
				"page",
				"page.md",
				"page.MD",
				"page.mD",
				"page.json",
				"page.v2.md",
				"page.",
				"page%2Emd",
				"dir.v1/page",
			]) {
				for (const ending of ["", "/", "//"]) {
					const path = `${prefix}${name}${ending}`;
					for (const method of ["GET", "HEAD"]) {
						assert.equal(
							matcher.test(path),
							shouldNegotiate(path, method),
							`${method} ${path}`,
						);
					}
				}
			}
		}
	});

	it("bypasses middleware for every checked-in public file except Markdown pages", () => {
		const publicDir = resolve(ROOT, "public");
		for (const entry of readdirSync(publicDir, {
			recursive: true,
			withFileTypes: true,
		})) {
			if (!entry.isFile()) continue;
			const absolute = resolve(entry.parentPath, entry.name);
			const path = `/${absolute.slice(publicDir.length + 1)}`;
			assert.equal(matcher.test(path), shouldNegotiate(path, "GET"), path);
			assert.equal(
				matcher.test(path) && !path.endsWith(".md"),
				false,
				`${path} is a static resource or Markdown page`,
			);
		}
	});
});
