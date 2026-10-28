// Canonical operation equipment identifiers, shared by validation and rendering.
const FLOW_EQUIPMENT = new Set([
	"Air fryer",
	"Baking dish",
	"Blender",
	"Chopping board",
	"Grill",
	"Instant Pot",
	"Kitchen utensils",
	"Large bowl",
	"Microwave",
	"Oven",
	"Pans",
	"Serving dishes",
	"Sieve",
	"Slow cooker",
	"Small bowl",
	"Spiralizer",
	"Waffle iron",
]);

/** Validate the current published schema where canonical registries enter the app. */
export function validateOperationEquipment(recipe) {
	function visit(node) {
		if (!node.children) return;
		if (
			!Array.isArray(node.equipment) ||
			!node.equipment.length ||
			new Set(node.equipment).size !== node.equipment.length ||
			node.equipment.some((name) => !FLOW_EQUIPMENT.has(name))
		)
			throw new Error(`Invalid operation equipment: ${recipe.id}`);
		node.children.forEach(visit);
	}
	visit(recipe.flow.root);
	return true;
}
