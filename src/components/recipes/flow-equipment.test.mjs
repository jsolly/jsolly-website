import assert from "node:assert/strict";
import { it } from "vitest";
import { flowEquipment } from "./flow-equipment.mjs";

it("compacted preparation and cooking cells identify their separate tools", () => {
	assert.deepEqual(
		flowEquipment(
			"Coat thighs with oil and spices. Then: Chicken basket: air fry at 390°F for 16–22 min.",
			["Two air fryers"],
		),
		["Air fryer", "Large bowl"],
	);
	assert.deepEqual(
		flowEquipment(
			"Toss zucchini with oil on its own pan. Then: roast at 425°F.",
		),
		["Oven", "Pans"],
	);
});
it("large ingredient mixes and small sauces have distinct bowls", () => {
	assert.deepEqual(
		flowEquipment("Bowl: whisk eggs, water, garlic, salt and pepper."),
		["Large bowl"],
	);
	assert.deepEqual(flowEquipment("Mix yogurt sauce."), ["Small bowl"]);
	assert.deepEqual(
		flowEquipment(
			"Whisk lemon juice, garlic and chicken broth; reserve sauce.",
		),
		["Small bowl"],
	);
});
it("cold preparation does not inherit the recipe's cooking appliances", () => {
	assert.deepEqual(
		flowEquipment("Prepare cucumber and greens.", ["Oven", "Pans"]),
		["Chopping board"],
	);
	assert.deepEqual(
		flowEquipment(
			"Plate cooked chicken and finished broccoli as separate components.",
			["Two air fryers"],
		),
		["Serving dishes"],
	);
	assert.deepEqual(
		flowEquipment("Spoon pesto over cooked fish after roasting.", ["Oven"]),
		["Kitchen utensils"],
	);
});
it("pressure cooking and named vessels remain specific", () => {
	assert.deepEqual(
		flowEquipment("Set Instant Pot to Sauté. Brown sausage and add onion."),
		["Instant Pot"],
	);
	assert.deepEqual(
		flowEquipment("High pressure 8 min; natural release 10 min."),
		["Instant Pot"],
	);
	assert.deepEqual(
		flowEquipment("Transfer to selected greased dishes; divide the mixture."),
		["Baking dish"],
	);
	assert.deepEqual(
		flowEquipment("Lightly oil both baskets; load patties with gaps.", [
			"Two air fryers",
		]),
		["Air fryer"],
	);
});
it("continuations and ambiguous preparation use a suitable honest tool", () => {
	assert.deepEqual(
		flowEquipment("Return chicken and warm through.", ["Stovetop", "Pans"]),
		["Pans"],
	);
	assert.deepEqual(
		flowEquipment("Remaining rub for exterior; unused excess may remain."),
		["Kitchen utensils"],
	);
	assert.deepEqual(flowEquipment("Spiralize zucchini."), ["Spiralizer"]);
});
