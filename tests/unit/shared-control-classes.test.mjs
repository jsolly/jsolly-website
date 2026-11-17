import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "svelte/compiler";
import { tv } from "tailwind-variants/lite";
import { it } from "vitest";
import { cn } from "../../src/lib/utils.js";

const WHITESPACE = /\s+/u;
const UI = new URL("../../src/lib/components/ui/", import.meta.url);
const source = readFileSync(new URL("button.svelte", UI), "utf8");
const declaration = parse(source).module.content.body.find(
	(node) =>
		node.type === "ExportNamedDeclaration" &&
		node.declaration?.declarations?.[0]?.id.name === "buttonVariants",
);
if (!declaration)
	throw new Error("The shared Button must export its variant composer");
const expression = declaration.declaration.declarations[0].init;
// Execute the actual first-party variant declaration against its installed merger.
const buttonVariants = runInNewContext(
	source.slice(expression.start, expression.end),
	{ tv },
	{ timeout: 1000 },
);

function primitiveClasses(file, rootName, contentName) {
	const markup = parse(readFileSync(new URL(file, UI), "utf8")).html;
	const root = markup.children.find((node) => node.name === rootName);
	const content = contentName
		? root.children.find((node) => node.name === contentName)
		: root;
	const attribute = content.attributes.find((node) => node.name === "class");
	const literal = attribute.value[0].expression.arguments[0];
	if (literal.type !== "Literal")
		throw new Error("The primitive must declare its class list");
	return literal.value;
}

it("every shared Button size retains its semantic variant foreground", () => {
	const foregrounds = {
		default: "text-primary-foreground",
		secondary: "text-secondary-foreground",
		destructive: "text-destructive",
		link: "text-primary",
	};
	for (const [variant, foreground] of Object.entries(foregrounds)) {
		for (const size of [
			"default",
			"xs",
			"sm",
			"lg",
			"icon",
			"icon-xs",
			"icon-sm",
			"icon-lg",
		]) {
			assert.ok(
				cn(buttonVariants({ variant, size }))
					.split(WHITESPACE)
					.includes(foreground),
				`${variant}/${size} preserves its foreground`,
			);
		}
	}
});

it("compact Button sizes compose with caller font and corner overrides", () => {
	for (const size of ["xs", "sm", "icon-xs", "icon-sm"]) {
		const defaults = cn(buttonVariants({ size })).split(WHITESPACE);
		assert.equal(
			defaults.includes("rounded-lg"),
			false,
			`${size} replaces the base corner radius`,
		);
		const overridden = cn(
			buttonVariants({ size }),
			"rounded-none text-xl",
		).split(WHITESPACE);
		assert.deepEqual(
			overridden.filter((item) => item.startsWith("rounded-")),
			["rounded-none"],
		);
		assert.equal(overridden.includes("text-xl"), true);
		assert.equal(
			overridden.some(
				(item) =>
					item === "text-xs" ||
					item === "text-sm" ||
					item.startsWith("text-(length:"),
			),
			false,
		);
	}
});

it("the shared Checkbox allows a caller to replace its corner radius", () => {
	const classes = primitiveClasses("checkbox.svelte", "CheckboxPrimitive.Root");
	const result = cn(classes, "rounded-full").split(WHITESPACE);
	assert.deepEqual(
		result.filter((item) => item.startsWith("rounded-")),
		["rounded-full"],
	);
});

it("the shared Dialog allows callers to replace both responsive width limits", () => {
	const classes = primitiveClasses(
		"dialog-content.svelte",
		"DialogPortal",
		"DialogPrimitive.Content",
	);
	const result = cn(classes, "max-w-lg sm:max-w-xl").split(WHITESPACE);
	assert.deepEqual(
		result.filter(
			(item) => item.startsWith("max-w-") || item.startsWith("sm:max-w-"),
		),
		["max-w-lg", "sm:max-w-xl"],
	);
});
