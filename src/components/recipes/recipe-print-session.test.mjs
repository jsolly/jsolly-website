import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { JSDOM } from "jsdom";
import { createRecipePrintSession } from "./recipe-print-session.mjs";

// The session reads the page's document and window as globals, as it does in
// the browser; each test gets a fresh jsdom page.
let dom;

beforeEach(() => {
	dom = new JSDOM("<!doctype html><html><body></body></html>");
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
});

afterEach(() => {
	globalThis.window = undefined;
	globalThis.document = undefined;
	dom.window.close();
});

const mode = () => document.documentElement.getAttribute("data-recipe-print");
const printEvent = (type) => window.dispatchEvent(new window.Event(type));

it("a browser-menu print sets the recipe print mode and restores the page's earlier mode afterwards", () => {
	document.documentElement.setAttribute("data-recipe-print", "library");
	const calls = [];
	const session = createRecipePrintSession(
		() => "recipe",
		() => calls.push("prepared"),
		() => calls.push("restored"),
	);
	const stop = session.listen();
	printEvent("beforeprint");
	const during = mode();
	printEvent("afterprint");
	const after = mode();
	stop();
	printEvent("beforeprint");
	assert.deepEqual(
		{ during, after, afterStop: mode(), calls },
		{
			during: "recipe",
			after: "library",
			afterStop: "library",
			calls: ["prepared", "restored", "restored"],
		},
	);
});

it("a page with no earlier print mode has none again once printing ends, even when prepared twice", () => {
	const session = createRecipePrintSession(() => "recipe");
	session.prepare();
	session.prepare();
	const during = mode();
	session.restore();
	assert.deepEqual(
		{ during, after: mode() },
		{ during: "recipe", after: null },
	);
});
