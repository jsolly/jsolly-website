import assert from "node:assert/strict";
import { it } from "vitest";
import { validateOperationEquipment } from "./flow-equipment.js";
import { ingredientIcon } from "./ingredient-icon.js";
import { orderRecipeIds } from "./recipe-order.js";

it("seeded recipe order is independent of input order and leaves input intact", () => {
	const ids = ["salmon", "chicken", "smoothie", "salad"];
	const original = [...ids];
	const ordered = orderRecipeIds(ids, "shared-seed");
	assert.deepEqual(ordered, ["smoothie", "chicken", "salad", "salmon"]);
	assert.deepEqual(ordered, orderRecipeIds([...ids].reverse(), "shared-seed"));
	assert.deepEqual([...ordered].sort(), [...ids].sort());
	assert.deepEqual(ids, original);
	assert.deepEqual(orderRecipeIds([], "shared-seed"), []);
	assert.deepEqual(orderRecipeIds(["salmon"], "shared-seed"), ["salmon"]);
});

it("ingredient symbols retain specific-match precedence and an empty fallback", () => {
	assert.equal(ingredientIcon("green beans"), "🫛");
	assert.equal(ingredientIcon("feta cheese"), "🧀");
	assert.equal(ingredientIcon("WATER"), "💧");
	assert.equal(ingredientIcon("unknown ingredient"), "");
});

it("equipment validation reaches nested operations and rejects non-string names", () => {
	const valid = {
		id: "example",
		flow: { root: { equipment: ["Oven"], children: [{}] } },
	};
	assert.equal(validateOperationEquipment(valid), true);
	for (const equipment of [[42], [null], ["Oven", "Oven"], [], undefined]) {
		assert.throws(
			() =>
				validateOperationEquipment({
					id: "example",
					flow: {
						root: {
							equipment: ["Oven"],
							children: [{ equipment, children: [{}] }],
						},
					},
				}),
			/Invalid operation equipment: example/u,
		);
	}
});
