import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import it from "node:test";
import { ingredientGrams } from "./ingredient-units.mjs";
import { ingredientAmount } from "./recipe-logic.mjs";
import { flowGrid, gridHtml, validateFlow } from "./trn-logic.mjs";

const { recipes } = JSON.parse(
	readFileSync(new URL("./recipes.json", import.meta.url), "utf8"),
);
const SPRAY = /spray/iu;
const MEASURED_SPRAY = /cooking spray/iu;
const UNALLOCATED = /Unallocated/u;
const UNBALANCED = /Unbalanced/u;
const GARLIC_GRAMS = /0.78 g/u;
const SAFE_FISH_METRIC = /63°C \(145°F\)/u;
const ONE_GRAM_ZEST = /1 g<\/strong> Lemon zest/u;
const MEASURED_PINCH = /0.3 g/u;
const UNMEASURED = /pinch of|remaining|to taste|unavailable/u;
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
it("tables show scaled gram amounts, safe endpoints and measured pinch allocations", () => {
	const salmon = recipes.find((r) => r.key === "salmon");
	const html = gridHtml(
		salmon.title,
		flowGrid(salmon, { servings: 2, units: "metric" }),
	);
	assert.match(html, GARLIC_GRAMS);
	assert.match(html, SAFE_FISH_METRIC);
	assert.match(html, ONE_GRAM_ZEST);
	const shawarma = recipes.find((r) => r.key === "shawarma");
	const s = gridHtml(
		shawarma.title,
		flowGrid(shawarma, { servings: 4, units: "metric" }),
	);
	assert.match(s, MEASURED_PINCH);
	for (const row of flowGrid(shawarma, { servings: 4, units: "grams" }).rows)
		assert.doesNotMatch(row.ingredient.quantity, UNMEASURED);
	assert.match(s, ROWSPAN);
});

it("measured salt pinches and remainder branches conserve the actual scaled ingredient", () => {
	const recipe = recipes.find((r) => r.key === "shawarma");
	assert(validateFlow(recipe));
	const seasoning = recipe.ingredients.find(
		(ingredient) => ingredient.id === "fine_salt",
	);
	for (const servings of [2, 4, 6, 8]) {
		const rows = flowGrid(recipe, { servings, units: "grams" }).rows.filter(
			(row) => row.ingredient.ingredientId === "fine_salt",
		);
		assert.equal(rows.length, 3);
		assert.equal(
			rows.find((row) => row.ingredient.share === "pinch").ingredient.quantity,
			"0.3 g",
		);
		const total = rows.reduce(
			(sum, row) => sum + ingredientGrams(seasoning, row.ingredient.amount),
			0,
		);
		assert.ok(
			Math.abs(
				total -
					ingredientGrams(seasoning, ingredientAmount(seasoning, servings)),
			) < 1e-9,
		);
		assert.ok(rows.every((row) => row.ingredient.amount > 0));
	}
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

it("table text escapes HTML-special characters in titles and ingredient names", () => {
	const recipe = structuredClone(recipes[0]);
	const special = `Fish & chips <b>"crispy"</b> 'n' salt`;
	recipe.title = special;
	recipe.ingredients[0].name = special;
	const html = gridHtml(
		recipe.title,
		flowGrid(recipe, { servings: 4, units: "us" }),
	);
	const escaped =
		"Fish &amp; chips &lt;b&gt;&quot;crispy&quot;&lt;/b&gt; &#39;n&#39; salt";
	assert.ok(html.includes(`aria-label="${escaped} cooking flow`));
	assert.ok(html.includes(`</strong> ${escaped}<small`));
	assert.ok(!html.includes(special));
	assert.ok(!html.includes("<b>"));
});

it("unmeasured cookware spray stays in preparation directions while measured oil alternatives remain allocated", () => {
	for (const recipe of recipes) {
		assert.equal(
			recipe.ingredients.some(
				(ingredient) =>
					SPRAY.test(ingredient.name) && ingredient.amount === null,
			),
			false,
			recipe.id,
		);
	}
	const preparation = {
		"source-steak-rolls":
			"Grease the skillet with cooking spray or a little olive oil before searing",
		"source-sausage-broccoli-cheddar-sheet-pan":
			"Line a baking sheet and lightly coat it with cooking oil spray",
		"source-lemon-garlic-shrimp-and-broccolini-sheet-pan-meal":
			"Lightly spray a rimmed baking sheet with oil if desired",
		"source-basic-keto-chaffle-recipe":
			"Lightly coat with cooking spray if needed and permitted by the manual",
	};
	for (const [id, instruction] of Object.entries(preparation)) {
		const recipe = recipes.find((candidate) => candidate.id === id);
		assert.ok(recipe.flow.prep.join(" ").includes(instruction), id);
		assert(validateFlow(recipe));
	}
	const measured = recipes.flatMap((recipe) =>
		recipe.ingredients.filter((ingredient) =>
			ingredient.alternatives?.some((choice) => SPRAY.test(choice.name)),
		),
	);
	assert.equal(measured.length, 2);
	for (const ingredient of measured) {
		assert.equal(ingredient.amount, 1);
		assert.equal(ingredient.unit, "tbsp");
		const spray = ingredient.alternatives.find((choice) =>
			SPRAY.test(choice.name),
		);
		assert.match(spray.name, MEASURED_SPRAY);
		assert.equal(spray.amount, 1);
		assert.equal(spray.unit, "g");
	}
});
