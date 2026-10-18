import assert from "node:assert/strict";
import it from "node:test";
import { JSDOM } from "jsdom";
import data from "./recipe-data.server.mjs";
import { documentMarkdown, recipeDocument } from "./recipe-export.mjs";
import { flowGrid, gridHtml } from "./trn-logic.mjs";

const { recipes } = data;
const HEAT =
	/cayenne|jalape|sriracha|hot sauce|chipotle|chili|chilli|harissa|cajun|taco (?:seasoning|spice)|pepperoncini|enchilada|rotel|andouille|spicy|^(?:crushed )?red pepper(?: flakes)?$/iu;
const ADJUSTMENT = /less heat|more heat/u;
const SWEET = /bell pepper|^(?:smoked |ground )?paprika$/iu;

it("every heat-bearing ingredient carries adjustment guidance into cooking and downloads", () => {
	for (const recipe of recipes) {
		const hot = recipe.ingredients.filter((ingredient) =>
			HEAT.test(ingredient.name),
		);
		if (!hot.length) continue;
		const document = recipeDocument(recipe, { servings: 6, units: "metric" });
		const markdown = documentMarkdown(document);
		const cookingHtml = gridHtml(
			recipe.title,
			flowGrid(recipe, { servings: 6, units: "metric" }),
		);
		const cooking = new JSDOM(cookingHtml).window.document.body.textContent;
		for (const ingredient of hot) {
			assert.match(
				ingredient.note,
				ADJUSTMENT,
				`${recipe.id}: ${ingredient.name}`,
			);
			assert(
				markdown.includes(ingredient.note),
				`${recipe.id}: Markdown heat note`,
			);
			assert(
				cooking.includes(ingredient.note),
				`${recipe.id}: cooking heat guidance`,
			);
		}
		for (const ingredient of recipe.ingredients.filter((item) =>
			SWEET.test(item.name),
		)) {
			assert.doesNotMatch(
				ingredient.note || "",
				ADJUSTMENT,
				`${recipe.id}: mild ingredient`,
			);
		}
	}
});
