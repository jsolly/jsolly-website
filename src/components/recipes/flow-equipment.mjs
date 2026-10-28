// The tools named by an operation, rather than every appliance in the recipe.
// A compacted cell can contain several actions, so it can show several tools.
const TOOL_RULES = [
	["Air fryer", /\bair[ -]fry(?:er|ers)?\b/iu],
	[
		"Instant Pot",
		/\binstant pot\b|\bhigh pressure\b|\b(?:natural|quick) release\b|\bfloat (?:valve )?drops\b/iu,
	],
	["Slow cooker", /\bslow[- ]cook(?:er)?\b/iu],
	["Microwave", /\bmicrowave\b/iu],
	["Blender", /\bblend(?:er)?\b/iu],
	["Grill", /\bgrill\b/iu],
	["Waffle iron", /\bchaffle\b|\bwaffle iron\b/iu],
	["Oven", /\b(?:bake|roast|roasting|broil|broiler|oven)\b/iu],
	[
		"Pans",
		/\b(?:skillet|pan|pans|tray|sheet|saute|sear|(?<!air )(?<!air-)fry|pan-fry|stir-fry|simmer|deglaze|caramelize|brown|crisp bacon|melt butter|over medium|over low|over high|blanch)\b|sauté/iu,
	],
	["Sieve", /\bsieve\b/iu],
	[
		"Baking dish",
		/\b(?:baking dish|greased dish|casserole dish|selected greased dishes)\b/iu,
	],
	["Spiralizer", /\bspiralize\b/iu],
	[
		"Chopping board",
		/\b(?:pat .+ dry|cut|slice|chop|trim|halve|butterfly|shred|dice|rice fresh|rice cauliflower|prepare cucumber|prepare lettuce|form patties|rub dry|stuff cavity)\b/iu,
	],
	[
		"Serving dishes",
		/\b(?:plate|serve|serving glasses|serving dishes|divide among)\b/iu,
	],
];
const SMALL_BOWL =
	/\b(?:small bowl|mix .*(?:sauce|rub|seasoning|butter|salsa|marinade)|whisk (?:(?:lemon )?juice|water)|whisk .*(?:sauce|coating)|combine .*(?:seasonings|tomatoes))\b/iu;
const MIXING =
	/\b(?:bowl|mix|whisk|toss|coat|marinate|refrigerate|combine|dip dry|keep clean quarter marinade|stir .+ into whisked eggs)\b/iu;
const HEAT =
	/\b(?:cook|heat|warm|melt|soften|boil|reduce|wilt|saute|sear|fry|simmer|brown|bake|roast|broil|air fry|grill|return|reheat|scrape|thicken)\b|sauté/iu;

const HISTORICAL_HEAT = /\b(?:after|during) (?:roasting|baking|cooking)\b/giu;
const PRESSURE = /\binstant pot\b|\bhigh pressure\b/iu;
const NAMED_PAN = /\b(?:pan|skillet)\b/iu;
const IN_VESSEL = /\b(?:on|in|into) .*(?:pan|basket|skillet|pot)\b/iu;
const BASKET = /\bbaskets?\b/iu;
const AIR_FRYER = /air fryer/iu;

export function flowEquipment(action, appliances = []) {
	const activeText = action.replace(HISTORICAL_HEAT, "");
	const tools = TOOL_RULES.filter(([, pattern]) => pattern.test(activeText))
		.map(([name]) => name)
		.filter(
			(name) =>
				name !== "Pans" ||
				!PRESSURE.test(activeText) ||
				NAMED_PAN.test(activeText),
		);
	if (MIXING.test(action)) {
		// Named pans/baskets already provide the vessel for tossing or mixing.
		const inVessel = IN_VESSEL.test(action);
		if (!inVessel)
			tools.push(SMALL_BOWL.test(action) ? "Small bowl" : "Large bowl");
	}
	// Continuations such as "return chicken and warm" omit the pan's name.
	// Use the recipe's cooking vessel only when this action actually heats food.
	if (
		!tools.length &&
		BASKET.test(action) &&
		appliances.some((name) => AIR_FRYER.test(name))
	)
		tools.push("Air fryer");
	if (!tools.length && HEAT.test(action)) {
		if (appliances.includes("Instant Pot")) tools.push("Instant Pot");
		else if (appliances.includes("Slow cooker")) tools.push("Slow cooker");
		else if (appliances.includes("Pans")) tools.push("Pans");
	}
	return tools.length ? [...new Set(tools)] : ["Kitchen utensils"];
}
