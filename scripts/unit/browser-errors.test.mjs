import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import it from "node:test";
import { collectErrors } from "../built/pages.mjs";

it("browser checks always observe console and page errors, with optional warnings", () => {
	const page = new EventEmitter();
	const errors = collectErrors(page);
	const withWarnings = collectErrors(page, { warnings: true });
	for (const type of ["log", "warning", "error"])
		page.emit("console", { type: () => type, text: () => `${type} message` });
	page.emit("pageerror", new Error("uncaught failure"));
	assert.deepEqual(errors, ["error message", "Error: uncaught failure"]);
	assert.deepEqual(withWarnings, [
		"warning message",
		"error message",
		"Error: uncaught failure",
	]);
});
