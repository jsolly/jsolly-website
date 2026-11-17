// Import decisions belong in provenance, rather than beside cooking inputs.
const IMPORT_NOTE =
	/(?:not counted in nutrition|included in this estimate|excluded or included as stated in the publisher nutrition|is the source parenthetical; original US quantity controls|^Source quantity range .* (?:lower endpoint chosen explicitly|lower value selected for scaling)|^Unquantified amount remains unknown, not zero|^Added from (?:the )?source method|^Ingredient recovered from the source method|^Source misspells tablespoons)/iu;
const SENTENCES = /(?<=\.)\s+(?=[A-Z(])/u;
const REWRITES = [
	[/lower one-tablespoon amount chosen, /giu, ""],
	[/source suggests /giu, "Use "],
	[/Source method allows /giu, "Use "],
	[
		/Source method requires coating oil but omits amount\./giu,
		"Lightly coat with oil.",
	],
	[
		/Source instruction requires oil but gives no quantity or type\./giu,
		"Use oil for cooking.",
	],
	[/More to taste is permitted by source\./giu, "Add more to taste."],
	[/Source also allows /giu, "Alternatively, use "],
	[/Source calls for /giu, "Use "],
	[/Source uses /giu, "Use "],
	[/source specifies one /giu, "one "],
	[
		/Source adds fresh cracked pepper without a quantity/giu,
		"Fresh cracked pepper to taste",
	],
	[
		/Explicit adaptation: use paprika to taste because source says ¼ paprika without a unit\./giu,
		"Use paprika to taste.",
	],
	[/\(dried oregano Source measure undefined/giu, "dried oregano"],
	[/Source says (?:3–6 thighs|approximately this amount)/giu, ""],
	[/source range [^·;]+/giu, ""],
	[/Source (?:says|specifies|gives) /giu, ""],
	[/Two-thirds of the source /giu, "Two-thirds of the "],
	[/full surplus source blend batch/giu, "full surplus blend batch"],

	[
		/Choose fully cooked smoked sausage for source timing\./iu,
		"Choose fully cooked smoked sausage.",
	],
	[/Explicit safety adaptation: /giu, ""],
	[
		/pre-cooked \(required by method, preparation unspecified by source\)/giu,
		"pre-cooked",
	],
	[/Source specifies a heaping measure\./giu, "Use a heaping measure."],
	[/Ghee is the source alternative\./giu, "Ghee also works."],
	[
		/Vegetable stock is an explicit source alternative\./giu,
		"Vegetable stock also works.",
	],
	[/Source alternative is /giu, "Alternative: "],
	[/Source can is /giu, "Can: "],
];
const CLAUSES = /;\s*/u;
// Known import annotations; unmatched cooking text is preserved.
const PROVENANCE =
	/^(?:Source (?:quantity range|range|gives a range|does not state|also (?:provides|gives approximately)|gives (?:no |50 g only)|has malformed|ingredient list omits|leaves pepper|omits can|packet size|supplies no|combines salt|blend ratios|“2\+2|1\/4 cup)|source (?:package weight|does not specify)|No amounts or proportions supplied|Unquantified (?:in source|garnish mentioned)|Malformed source|One of the three separately measured|Retain this source|The source leaves|Cooking medium explicitly quantified|Additional quantity explicitly stated|amount is its lower endpoint|lower (?:endpoint|value)|three chosen|the package size is preserved|this adaptation uses)/iu;
export const OMITTED_PREPARATION = /^Check\b.*°[FC]|^For larger servings,/iu;
export function cookingNotes(state) {
	return state
		.split(" · ")
		.flatMap((part) => part.split(SENTENCES))
		.filter((part) => !IMPORT_NOTE.test(part))
		.flatMap((part) => part.split(CLAUSES))
		.filter((part) => !PROVENANCE.test(part))
		.map((part) =>
			REWRITES.reduce(
				(text, [pattern, replacement]) => text.replace(pattern, replacement),
				part,
			),
		)
		.filter((part) => !IMPORT_NOTE.test(part))
		.flatMap((part) => part.split(CLAUSES))
		.filter(
			(part) =>
				part.trim() && !IMPORT_NOTE.test(part) && !PROVENANCE.test(part),
		)
		.join(" · ");
}

/** Ingredient production labels do not change how the food is prepared. */
export function ingredientText(value) {
	return String(value ?? "")
		.replace(
			/\b(?:organic|conventionally grown|conventional(?! (?:oven|bake|heat)))\b\s*/giu,
			"",
		)
		.replace(/ {2,}/gu, " ")
		.trim();
}
