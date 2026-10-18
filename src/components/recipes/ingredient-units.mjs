export const UNIT_LABELS = {
	grams: "Grams",
	us: "US imperial",
	metric: "Metric",
};
// NIST customary units. A fluid ounce is volume, never mass.
const MASS_GRAMS = { g: 1, oz: 28.349523125, lb: 453.59237 };
const VOLUME_ML = {
	ml: 1,
	"fl oz": 29.5735295625,
	tsp: 4.92892159375,
	tbsp: 14.78676478125,
	cup: 236.5882365,
};
const positive = (value) => Number.isFinite(value) && value > 0;

function invalid(ingredient, reason) {
	throw new Error(
		`Invalid measurement for ${ingredient.recipeId ? `${ingredient.recipeId}/` : ""}${ingredient.id || ingredient.name || ingredient.ingredientName || "unnamed ingredient"}: ${reason}`,
	);
}

export function unitPreference(value) {
	return typeof value === "string" && Object.hasOwn(UNIT_LABELS, value)
		? value
		: "us";
}

/** Round once for display and retain a positive numeric quantity for tiny spices. */
function measureNumber(value, decimals = value >= 10 ? 0 : value >= 1 ? 1 : 2) {
	const rounded = Number(value.toFixed(decimals));
	return String(rounded || Number(value.toPrecision(2)));
}

/** Explicit cooking references only. Display prose never determines food identity. */
export function ingredientWeight(ingredient) {
	const ref = ingredient.weightRef ? ingredient.weightReference : null;
	if (ingredient.weightRef && (!ref || ref.id !== ingredient.weightRef))
		invalid(ingredient, `unknown weightRef ${ingredient.weightRef}`);
	const mass = MASS_GRAMS[ingredient.unit];
	if (mass)
		return {
			gramsPerUnit: mass,
			source: "https://www.nist.gov/pml/special-publication-811",
			kind: ref?.kind || "mass",
			...(ref
				? {
						referenceId: ref.id,
						gramsPerMl: ref.gramsPerMl,
						referenceSource: ref.source,
					}
				: {}),
		};
	if (!ref) invalid(ingredient, `missing weightRef for ${ingredient.unit}`);
	const direct = ref.measures[ingredient.unit];
	let gramsPerUnit;
	if (direct) {
		if (!positive(direct.grams) || !positive(direct.amount))
			invalid(
				ingredient,
				`invalid ${ingredient.unit} observation in ${ref.id}`,
			);
		gramsPerUnit = direct.grams / direct.amount;
	} else if (ref.volumeInterpolationUnit && VOLUME_ML[ingredient.unit]) {
		const unit = ref.volumeInterpolationUnit;
		const observation = ref.measures[unit];
		if (
			!VOLUME_ML[unit] ||
			!positive(observation?.grams) ||
			!positive(observation?.amount)
		)
			invalid(
				ingredient,
				`invalid volume interpolation observation in ${ref.id}`,
			);
		gramsPerUnit =
			(observation.grams / observation.amount / VOLUME_ML[unit]) *
			VOLUME_ML[ingredient.unit];
	} else if (
		ref.kind === "liquid" &&
		positive(ref.gramsPerMl) &&
		VOLUME_ML[ingredient.unit]
	) {
		gramsPerUnit = ref.gramsPerMl * VOLUME_ML[ingredient.unit];
	} else {
		invalid(ingredient, `no ${ingredient.unit} observation in ${ref.id}`);
	}
	return {
		gramsPerUnit,
		source: ref.source,
		description: ref.description,
		kind: ref.kind,
		referenceId: ref.id,
		gramsPerMl: ref.gramsPerMl,
	};
}

/** Preserve the unrounded cooking mass through scaling and every consumer. */
export function ingredientGrams(ingredient, amount = ingredient.amount) {
	if (!positive(amount))
		invalid(ingredient, "amount must be finite and positive");
	const grams = amount * ingredientWeight(ingredient).gramsPerUnit;
	if (!positive(grams))
		invalid(ingredient, "resolved grams must be finite and positive");
	return grams;
}

/** Canonical input is already scaled. Unit switches never reuse a display value. */
export function ingredientMeasure(ingredient, amount, units, formatQuantity) {
	const grams = ingredientGrams(ingredient, amount);
	const weight = ingredientWeight(ingredient);
	const mass = MASS_GRAMS[ingredient.unit];
	const volume = VOLUME_ML[ingredient.unit];
	let quantity;
	let status;
	if (units === "us") {
		if (mass) {
			const unit = grams >= MASS_GRAMS.lb ? "lb" : "oz";
			quantity = `${measureNumber(grams / MASS_GRAMS[unit], 2)} ${unit}`;
			status = "mass";
		} else if (ingredient.unit === "ml") {
			quantity = `${measureNumber(amount / VOLUME_ML["fl oz"], 2)} fl oz`;
			status = "volume";
		} else {
			const shown =
				amount < 0.02 ? measureNumber(amount) : formatQuantity(amount);
			quantity = `${shown} ${ingredient.unit}`;
			status = volume ? "volume" : "portion";
		}
	} else if (units === "metric" && weight.kind === "liquid") {
		let milliliters;
		if (volume) milliliters = amount * volume;
		else {
			if (!positive(weight.gramsPerMl))
				invalid(
					ingredient,
					"liquid mass or portion needs an explicit gramsPerMl",
				);
			milliliters = grams / weight.gramsPerMl;
		}
		quantity = `${measureNumber(milliliters)} mL`;
		status = "volume";
	} else {
		quantity = `${measureNumber(grams)} g`;
		status = "mass";
	}
	const result = {
		quantity,
		status,
		grams,
		source:
			units === "metric" && weight.kind === "liquid"
				? weight.referenceSource || weight.source
				: weight.source,
	};
	if (ingredient.alternatives?.length) {
		if (!positive(ingredient.amount))
			invalid(ingredient, "alternative scaling needs a positive base amount");
		result.alternatives = ingredient.alternatives.map((alternative) => ({
			name: alternative.name,
			...ingredientMeasure(
				{
					...alternative,
					recipeId: ingredient.recipeId,
					id: `${ingredient.id}/${alternative.name}`,
				},
				alternative.amount * (amount / ingredient.amount),
				units,
				formatQuantity,
			),
		}));
	}
	return result;
}
