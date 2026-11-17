import assert from "node:assert/strict";
import { it } from "vitest";
import { cookText } from "./display-units.mjs";

it("settings and safety retain original, metric never lowers endpoint", () => {
	assert.equal(
		cookText("425°F then 165°F", "metric"),
		"220°C (425°F) then 74°C (165°F)",
	);
	assert.equal(
		cookText("145°F / 160°F", "metric"),
		"63°C (145°F) / 72°C (160°F)",
	);
});
it("geometry supports fractions, mixed numbers and dimensions without cascading conversions", () => {
	assert.equal(
		cookText("½-inch and 1½-inch pieces", "metric"),
		"1.27 cm (½-inch) and 3.81 cm (1½-inch) pieces",
	);
	assert.equal(
		cookText("18×13-inch pan", "metric"),
		"45.72×33.02 cm (18×13-inch) pan",
	);
	assert.equal(
		cookText("3¼ inches across", "metric"),
		"8.26 cm (3¼ inches) across",
	);
});
it("US text and pressure model remain unchanged", () => {
	assert.equal(
		cookText("Duo 6QT, 425°F, ½-inch", "us"),
		"Duo 6QT, 425°F, ½-inch",
	);
});

it("cooking geometry converts complete ranges once and preserves the whole original expression", () => {
	assert.equal(
		cookText("¼–½-inch pieces, 1-2 inches, 18×13-inch pan", "metric"),
		"0.64–1.27 cm (¼–½-inch) pieces, 2.54-5.08 cm (1-2 inches), 45.72×33.02 cm (18×13-inch) pan",
	);
	assert.equal(
		cookText("¼–½-inch pieces", "grams"),
		"0.64–1.27 cm (¼–½-inch) pieces",
	);
});
