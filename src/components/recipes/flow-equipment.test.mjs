import assert from "node:assert/strict";
import { it } from "vitest";
import { validateOperationEquipment } from "./flow-equipment.ts";
import data from "./recipe-data.server.mjs";
import { flowGrid, validateFlow } from "./trn-logic.mjs";

const recipe = () =>
	structuredClone(data.recipes.find((r) => r.key === "salmon"));
const tools = (r) =>
	flowGrid(r).rows.flatMap((row) =>
		row.cells
			.filter((cell) => cell.kind === "operation")
			.map((cell) => cell.equipment),
	);
const INVALID = /Invalid operation equipment/u;
it("every canonical cooking operation names its reviewed tools", () => {
	for (const r of data.recipes) {
		assert(validateOperationEquipment(r));
		for (const equipment of tools(r)) assert(equipment.length > 0, r.id);
	}
});
it("compacted preparation and cooking cells combine their separate tools", () => {
	const r = recipe();
	assert(
		tools(r).some(
			(equipment) =>
				equipment.includes("Chopping board") && equipment.includes("Air fryer"),
		),
	);
});
it("large ingredient mixes and small sauces retain distinct bowls", () => {
	const assigned = data.recipes.flatMap(tools).flat();
	assert(assigned.includes("Large bowl"));
	assert(assigned.includes("Small bowl"));
});
it("instruction edits do not change the equipment shown for an operation", () => {
	const r = recipe();
	const expected = tools(r);
	const rewrite = (node) => {
		if (node.children) {
			node.action = "Follow this step carefully.";
			node.children.forEach(rewrite);
		}
	};
	rewrite(r.flow.root);
	assert.deepEqual(tools(r), expected);
});
it("missing, duplicated and unsupported operation equipment fail at the recipe boundary", () => {
	for (const equipment of [undefined, [], ["Unknown tool"], ["Pans", "Pans"]]) {
		const r = recipe();
		r.flow.root.equipment = equipment;
		// Allocation-only validation remains usable by the frozen historical replay.
		assert(validateFlow(r));
		assert.throws(() => validateOperationEquipment(r), INVALID);
	}
});
