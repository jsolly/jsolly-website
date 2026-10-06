import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import it from "node:test";
import { flowGrid, flowHtml, validateFlow } from "./trn-logic.mjs";

const { recipes } = JSON.parse(
	readFileSync(new URL("./recipes.json", import.meta.url), "utf8"),
);
const UNALLOCATED = /Unallocated/u;
const UNBALANCED = /Unbalanced/u;
const QUARTER_TEASPOON = /¼ tsp/u;
const SAFE_FISH_METRIC = /63°C \(145°F\)/u;
const ONE_GRAM_ZEST = /1g<\/strong> Lemon zest/u;
const PINCH = /pinch of/u;
const HALF_REMAINING = /½ remaining/u;
const ROWSPAN = /rowspan=/u;
const INVALID_FRACTION = /Invalid ingredient fraction/u;
const UNBALANCED_SYMBOLIC = /Unbalanced symbolic allocation/u;
it("all recipe dependency diagrams allocate all ingredients and produce a complete nonoverlapping merged-cell grid", () => {
	for (const recipe of recipes) {
		assert(validateFlow(recipe));
		for (const servings of [2, 4, 6, 8]) {
			const grid = flowGrid(recipe, { servings, units: "metric" });
			const occupied = grid.rows.map(() => new Array(grid.columns).fill(false));
			for (let row = 0; row < grid.rows.length; row++)
				for (const cell of grid.rows[row].cells) {
					assert(cell.colspan > 0 && cell.rowspan > 0);
					for (let y = row; y < row + cell.rowspan; y++)
						for (let x = cell.col; x < cell.col + cell.colspan; x++) {
							assert(y < grid.rows.length && x < grid.columns, recipe.id);
							assert(!occupied[y][x], `${recipe.id} overlap${y},${x}`);
							occupied[y][x] = true;
						}
				}
			assert(
				occupied.every((row) => row.every(Boolean)),
				recipe.id,
			);
			assert(grid.columns <= 6, `${recipe.id} excessively wide`);
			const last = grid.rows[0].cells.at(-1);
			assert.equal(last.rowspan, grid.rows.length);
			assert.equal(last.col, grid.columns - 1);
		}
	}
});
it("incomplete or duplicate ingredient allocations fail closed", () => {
	const r = structuredClone(recipes[0]);
	r.flow.root.children.pop();
	assert.throws(() => validateFlow(r), UNALLOCATED);
	const r2 = structuredClone(recipes[0]);
	r2.flow.root.children.push({ ingredientId: "hemp_hearts" });
	assert.throws(() => validateFlow(r2), UNBALANCED);
});
it("tables keep scaled spoon measures, safe endpoint conversions and symbolic pinches", () => {
	const salmon = recipes.find((r) => r.key === "salmon");
	const html = flowHtml(salmon, { servings: 2, units: "metric" });
	assert.match(html, QUARTER_TEASPOON);
	assert.match(html, SAFE_FISH_METRIC);
	assert.match(html, ONE_GRAM_ZEST);
	const shawarma = recipes.find((r) => r.key === "shawarma");
	const s = flowHtml(shawarma, { servings: 4, units: "metric" });
	assert.match(s, PINCH);
	assert.match(s, HALF_REMAINING);
	assert.match(s, ROWSPAN);
});

it("split symbolic salt preserves one pinch and a complete positive remainder", () => {
	const recipe = recipes.find((r) => r.key === "shawarma");
	assert(validateFlow(recipe));
	const invalid = structuredClone(recipe);
	const branches = invalid.flow.root.children.at(2).children;
	branches[0].children.find((x) => x.share === "remainder").fraction = -1;
	branches[1].children.find((x) => x.share === "remainder").fraction = 2;
	assert.throws(() => validateFlow(invalid), INVALID_FRACTION);
	branches[0].children.find((x) => x.share === "remainder").fraction = 0.25;
	branches[1].children.find((x) => x.share === "remainder").fraction = 0.5;
	assert.throws(() => validateFlow(invalid), UNBALANCED_SYMBOLIC);
});

it("smoothie loading starts with liquids and keeps seeds and greens ahead of fruit", () => {
	for (const recipe of recipes.filter((r) => r.type === "smoothie")) {
		const rows = flowGrid(recipe, { servings: 4, units: "us" }).rows;
		assert.equal(rows[0].ingredient.ingredientId, "water", recipe.id);
		const ids = rows.map((r) => r.ingredient.ingredientId);
		const firstFruit = Math.min(
			...["avocado", "banana", "strawberry", "cucumber"]
				.map((id) => ids.indexOf(id))
				.filter((i) => i >= 0),
		);
		for (const id of ["lime", "yogurt", "flax", "hemp", "spinach"].filter(
			(early) => ids.includes(early),
		))
			assert.ok(ids.indexOf(id) < firstFruit, `${recipe.id} ${id}`);
	}
});
