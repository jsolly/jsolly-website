// Canonical operation equipment identifiers, shared by validation and rendering.
const FLOW_EQUIPMENT: ReadonlySet<unknown> = new Set([
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

// Leaves have no children; operation nodes carry untrusted equipment from JSON.
interface EquipmentNode {
	children?: EquipmentNode[];
	equipment?: unknown;
}
interface EquipmentRecipe {
	id: string;
	flow: { root: EquipmentNode };
}

/** Validate the current published schema where canonical registries enter the app. */
export function validateOperationEquipment(recipe: EquipmentRecipe): true {
	function visit(node: EquipmentNode): void {
		if (!node.children) return;
		if (
			!Array.isArray(node.equipment) ||
			!node.equipment.length ||
			new Set(node.equipment).size !== node.equipment.length ||
			node.equipment.some((name: unknown) => !FLOW_EQUIPMENT.has(name))
		)
			throw new Error(`Invalid operation equipment: ${recipe.id}`);
		node.children.forEach(visit);
	}
	visit(recipe.flow.root);
	return true;
}
