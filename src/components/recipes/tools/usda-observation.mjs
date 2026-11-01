// Validate one USDA observation before it enters a nutrient model.
export function observation(food, id, unit) {
	const matches = food.foodNutrients.filter(
		({ nutrient }) => nutrient.id === id,
	);
	if (matches.length > 1)
		throw new Error(`Duplicate nutrient ${id} in FDC ${food.fdcId}`);
	const value = matches[0];
	if (!value || value.amount === undefined) return;
	const expected = unit.startsWith("mcg") ? "ug" : unit;
	if (
		value.nutrient.unitName.toLowerCase().replace("µg", "ug") !==
			expected.toLowerCase() ||
		!Number.isFinite(value.amount) ||
		value.amount < 0
	)
		throw new Error(`Invalid nutrient ${id} in FDC ${food.fdcId}`);
	return value.amount;
}
