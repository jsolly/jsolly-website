import { cookingText } from "./cooking-quantities.mjs";
import { ingredientGrams, ingredientMeasure } from "./ingredient-units.mjs";
import {
	formatQuantity,
	ingredientAmount,
	purchaseNote,
	validateSettings,
} from "./recipe-logic.mjs";

const HTML_SPECIAL = /[&<>"']/gu;
const ESSENTIAL_STATE =
	/raw|thaw|fully cooked|drain|shelf-stable|package weight|jarred|squeeze-bottle/iu;
const escapeHtml = (value) =>
	String(value ?? "").replace(
		HTML_SPECIAL,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
/** Reject incomplete allocation trees instead of silently dropping ingredients from a diagram. */
export function validateFlow(recipe) {
	if (!recipe.flow?.root?.children?.length)
		throw new Error(`Missing TRN flow: ${recipe.id}`);
	const allocations = new Map();
	const seen = new Set();
	function visit(node) {
		if (seen.has(node)) throw new Error("Cyclic/reused TRN node");
		seen.add(node);
		if (node.children) {
			if (!node.action || !node.children.length)
				throw new Error("Empty operation");
			node.children.forEach(visit);
			return;
		}
		if (!recipe.ingredients.some((i) => i.id === node.ingredientId))
			throw new Error(`Unknown TRN ingredient ${node.ingredientId}`);
		const list = allocations.get(node.ingredientId) || [];
		list.push(node);
		allocations.set(node.ingredientId, list);
		if (node.share && !["pinch", "remainder"].includes(node.share))
			throw new Error("Unknown symbolic allocation");
		if (!(Number(node.fraction ?? 1) > 0) || Number(node.fraction ?? 1) > 1)
			throw new Error("Invalid ingredient fraction");
	}
	visit(recipe.flow.root);
	for (const i of recipe.ingredients) {
		const parts = allocations.get(i.id);
		if (!parts) throw new Error(`Unallocated ${i.id}`);
		if (parts.some((p) => p.share)) {
			if (
				parts.filter((p) => p.share === "pinch").length !== 1 ||
				parts.some((p) => !p.share) ||
				Math.abs(
					parts
						.filter((p) => p.share === "remainder")
						.reduce((sum, p) => sum + Number(p.fraction ?? 1), 0) - 1,
				) > 1e-9
			)
				throw new Error(`Unbalanced symbolic allocation ${i.id}`);
		} else if (
			Math.abs(parts.reduce((sum, p) => sum + Number(p.fraction ?? 1), 0) - 1) >
			1e-9
		)
			throw new Error(`Unbalanced allocation ${i.id}`);
	}
	return true;
}

/** A measured pinch is fixed; remainder branches divide the actual amount left. */
function allocationAmount(ingredient, node, servings) {
	const total = ingredientAmount(ingredient, servings);
	if (!node.share) return total * Number(node.fraction ?? 1);
	const grams = ingredientGrams(ingredient, total);
	if (!(ingredient.pinchGrams > 0 && ingredient.pinchGrams < grams))
		throw new Error(`Invalid measured pinch: ${ingredient.id}`);
	const pinch = (total * ingredient.pinchGrams) / grams;
	return node.share === "pinch"
		? pinch
		: (total - pinch) * Number(node.fraction ?? 1);
}
/** Compute a contiguous-row dependency graph. Children extend to their consuming column. */
export function flowGrid(recipe, settings = {}) {
	validateFlow(recipe);
	const { servings, units, familyDiners } = validateSettings(settings);
	const text = (value) => cookingText(recipe, value, { servings, units });
	const leaves = [];
	const operations = [];
	function walk(node, parent = null) {
		const item = { ...node, parent, start: leaves.length };
		if (!node.children) {
			item.depth = 0;
			item.rows = 1;
			const ingredient = recipe.ingredients.find(
				(i) => i.id === node.ingredientId,
			);
			const amount = allocationAmount(ingredient, node, servings);
			const measure = ingredientMeasure(
				ingredient,
				amount,
				units,
				formatQuantity,
			);
			item.quantity = measure.quantity;
			item.alternatives = measure.alternatives;
			item.amount = amount;
			item.name = ingredient.name;
			item.state = text(
				[ingredient.state, ingredient.note, purchaseNote(ingredient, servings)]
					.filter(Boolean)
					.join(" · "),
			);
			leaves.push(item);
			return item;
		}
		item.children = node.children.map((child) => walk(child, item));
		item.depth = 1 + Math.max(...item.children.map((child) => child.depth));
		item.rows = leaves.length - item.start;
		item.action = text(node.action);
		operations.push(item);
		return item;
	}
	function compact(node) {
		if (!node.children) return { ...node };
		const children = node.children.map(compact);
		if (children.length === 1 && children[0].children)
			return {
				action: `${children[0].action} Then: ${node.action}`,
				children: children[0].children,
			};
		return { ...node, children };
	}
	const root = walk(compact(recipe.flow.root));
	const rows = leaves.map((leaf) => ({
		ingredient: leaf,
		cells: [
			{
				kind: "ingredient",
				col: 0,
				colspan: leaf.parent.depth,
				rowspan: 1,
				text: leaf.quantity,
				name: leaf.name,
				state: leaf.state,
				alternatives: leaf.alternatives,
				essentialState: ESSENTIAL_STATE.test(leaf.state),
			},
		],
	}));
	for (const op of operations)
		rows[op.start].cells.push({
			kind: "operation",
			col: op.depth,
			colspan: op.parent ? op.parent.depth - op.depth : 1,
			rowspan: op.rows,
			text: op.action,
		});
	for (const r of rows) r.cells.sort((a, b) => a.col - b.col);
	const option =
		recipe.familyOptions?.find(
			(o) => o.id === settings.familyChoice?.[recipe.id],
		) || recipe.familyOptions?.[0];
	const side =
		option && familyDiners > 0
			? [
					"Warm the family side per package near the end of cooking; serve separately.",
				]
			: [];
	const pressure = recipe.ingredients
		.filter(
			(ingredient) =>
				ingredient.scale === "minimum" && ingredient.unit === "ml",
		)
		.map(
			(ingredient) =>
				`Use at least ${ingredientAmount(ingredient, servings)} mL ${ingredient.name.toLowerCase()} for pressure cooking.`,
		);
	return {
		prep: [...recipe.flow.prep, ...pressure, ...side].map(text),
		columns: root.depth + 1,
		rows,
	};
}
function ingredientHtml(cell) {
	const alternatives = (cell.alternatives || [])
		.map(
			(choice) =>
				` or <strong>${escapeHtml(choice.quantity)}</strong> ${escapeHtml(choice.name)}`,
		)
		.join("");
	return `<strong>${escapeHtml(cell.text)}</strong> ${escapeHtml(cell.name)}${alternatives}<small class="${cell.essentialState ? "trn-state-essential" : "trn-state-detail"}">${escapeHtml(cell.state)}</small>`;
}
export function gridHtml(title, grid) {
	return `<div class="trn-scroll" tabindex="0" role="region" aria-label="${escapeHtml(title)} cooking flow, scroll horizontally"><table class="trn-table"><tbody>${grid.prep.map((t) => `<tr><td colspan="${grid.columns}" class="trn-prep">${escapeHtml(t)}</td></tr>`).join("")}${grid.rows.map((r) => `<tr>${r.cells.map((c) => (c.kind === "ingredient" ? `<th scope="row" colspan="${c.colspan}" class="trn-ingredient">${ingredientHtml(c)}</th>` : `<td rowspan="${c.rowspan}" colspan="${c.colspan}" class="trn-operation">${escapeHtml(c.text)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}
