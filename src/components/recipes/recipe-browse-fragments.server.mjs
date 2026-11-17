import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { render } from "svelte/server";
import { SERVING_CHOICES } from "./constants.mjs";
import { recipeCardSummary } from "./recipe-summary.mjs";

const writes = new Map();
/** RecipeExperience calls this during the Astro build; fragments never enter dist. */
export function writeBrowseFragments(
	Card,
	recipes,
	collection,
	release,
	root = join(process.cwd(), ".recipe-browse"),
) {
	const key = `${root}/${collection}/${release}`;
	if (!writes.has(key))
		writes.set(
			key,
			(async () => {
				const cards = Object.fromEntries(
					SERVING_CHOICES.map((servings) => [
						servings,
						Object.fromEntries(
							recipes
								.filter((recipe) => recipe.type === collection)
								.map((recipe) => [
									recipe.id,
									render(Card, {
										props: {
											recipe: recipeCardSummary(recipe, servings),
											href: `/recipes/${recipe.id}/`,
										},
									}).body,
								]),
						),
					]),
				);
				await mkdir(root, { recursive: true });
				await writeFile(
					join(root, `${collection}.json`),
					JSON.stringify({ release, cards }),
				);
			})(),
		);
	return writes.get(key);
}
