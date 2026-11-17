import { recipeDocument } from "./recipe-export.mjs";
import { formatNutrition } from "./recipe-settings.mjs";

// This is the four-portion document shown before saved preferences load.
// Optional side dishes stay outside the base recipe and its nutrition.
export function recipeStructuredData(recipe, site) {
	const document = recipeDocument(recipe);
	const url = new URL(`/recipes/${recipe.id}/`, site).href;
	const nutrition = document.nutrition;
	const smoothie = recipe.type === "smoothie";
	const yieldCount = smoothie
		? recipe.estimatedYieldMl / (8 * 29.5735295625)
		: document.servings;
	const nutrient = (field, value, unit, decimals = 1) =>
		Number.isFinite(value)
			? { [field]: formatNutrition(value, unit, decimals) }
			: {};
	return {
		"@context": "https://schema.org",
		"@type": "Recipe",
		"@id": `${url}#recipe`,
		url,
		mainEntityOfPage: { "@type": "WebPage", "@id": url },
		isPartOf: { "@id": `${site.origin}/#website` },
		publisher: { "@id": `${site.origin}/#organization` },
		name: document.title,
		description: document.summary,
		inLanguage: "en-US",
		image: {
			"@type": "ImageObject",
			url: new URL(recipe.image.src, site).href,
			width: recipe.image.width,
			height: recipe.image.height,
			caption: recipe.image.caption,
		},
		recipeCategory: smoothie ? "Smoothie" : "Main course",
		keywords: "keto",
		recipeYield: smoothie
			? `${yieldCount.toFixed(1)} estimated 8 fl oz (237 mL) glasses`
			: `${document.servings} servings`,
		// A range or absent time is not an exact duration. Active time includes
		// cooking for household recipes, so it must not be relabeled prepTime.
		...(Number.isFinite(recipe.totalMin) &&
		recipe.totalMin > 0 &&
		recipe.totalMin === recipe.totalMax
			? { totalTime: `PT${recipe.totalMin}M` }
			: {}),
		recipeIngredient: document.ingredients.map(
			(ingredient) =>
				`${ingredient.quantity} ${ingredient.name}${ingredient.state ? `, ${ingredient.state}` : ""}${ingredient.note ? `. ${ingredient.note}` : ""}`,
		),
		recipeInstructions: [
			...document.cookingFlow.prep.map((text, index) => ({
				"@type": "HowToStep",
				name: `Preparation ${index + 1}`,
				text,
			})),
			...document.steps.map((step) => ({
				"@type": "HowToStep",
				name: step.title,
				text: step.text,
			})),
		],
		tool: document.equipment.map((name) => ({ "@type": "HowToTool", name })),
		nutrition: {
			"@type": "NutritionInformation",
			servingSize: smoothie
				? "1 estimated 8 fl oz (237 mL) glass"
				: "1 serving",
			...nutrient("calories", nutrition.kcal, "kcal", 0),
			...nutrient("proteinContent", nutrition.protein_g, "g"),
			...nutrient("fatContent", nutrition.fat_g, "g"),
			...nutrient("carbohydrateContent", nutrition.carbs_g, "g"),
			...nutrient("fiberContent", nutrition.fiber_g, "g"),
		},
		...(document.sourceRecipe
			? {
					isBasedOn:
						document.sourceRecipe.resolvedUrl ?? document.sourceRecipe.url,
				}
			: {}),
		citation: document.sources.map((source) => source.url),
	};
}
