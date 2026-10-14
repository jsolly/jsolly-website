import weights from "./ingredient-weights.json" with { type: "json" };

export const UNIT_LABELS = {
	grams: "Grams",
	us: "US imperial",
	metric: "Metric",
};
export const MEASUREMENT_POLICY =
	"Weights converted from volume or counts are approximate (~); the original measure follows in parentheses. Counts, packages and undefined measures stay as written when no reliable weight is available. US cups and spoons are US customary measures, not British Imperial. oz means mass; fl oz means volume. Changes affect ingredient quantities; source method and package notes retain their stated measures.";
// NIST customary units. Never treat a fluid ounce as an ounce of mass.
const MASS_GRAMS = { g: 1, oz: 28.349523125, lb: 453.59237 };
const VOLUME_ML = {
	ml: 1,
	"fl oz": 29.5735295625,
	tsp: 4.92892159375,
	tbsp: 14.78676478125,
	cup: 236.5882365,
};
const ALTERNATIVE_OR_PACKING = /\bor\b|\bpacked\b|\bheaping\b|\bwhipped\b/iu;
const references = new Map(
	weights.references.flatMap((ref) => ref.names.map((name) => [name, ref])),
);

export function unitPreference(value) {
	return typeof value === "string" && Object.hasOwn(UNIT_LABELS, value)
		? value
		: "us";
}

/** Round at the display boundary only, never a positive amount down to zero. */
function measureNumber(value, decimals = value >= 10 ? 0 : value >= 1 ? 1 : 2) {
	const rounded = Number(value.toFixed(decimals));
	return rounded === 0 && value > 0 ? "<0.01" : String(rounded);
}

/** Source-backed portion weights only. Nutrition estimates never enter this path. */
export function ingredientWeight(ingredient) {
	if (MASS_GRAMS[ingredient.unit])
		return {
			gramsPerUnit: MASS_GRAMS[ingredient.unit],
			approximate: false,
			source: "https://www.nist.gov/pml/special-publication-811",
		};
	if (
		ALTERNATIVE_OR_PACKING.test(
			[ingredient.name, ingredient.state, ingredient.note]
				.filter(Boolean)
				.join(" "),
		)
	)
		return null;
	if (ingredient.gramsPerUnit > 0 && ingredient.massSource)
		return {
			gramsPerUnit: ingredient.gramsPerUnit,
			approximate: true,
			source: ingredient.massSource,
			basis: ingredient.massBasis,
		};
	const ref = references.get(
		(ingredient.name || ingredient.ingredientName || "").trim().toLowerCase(),
	);
	if (!ref || !VOLUME_ML[ingredient.unit]) return null;
	const entry = ref.measures[ingredient.unit];
	const [unit, fallback] = Object.entries(ref.measures)[0];
	const gramsPerUnit = entry
		? entry.grams / entry.amount
		: ((fallback.grams / fallback.amount) * VOLUME_ML[ingredient.unit]) /
			VOLUME_ML[unit];
	return {
		gramsPerUnit,
		approximate: true,
		source: ref.source,
		description: ref.description,
		kind: ref.kind,
	};
}

/** Canonical input is already scaled. Unit switches never reuse a rounded display. */
export function ingredientMeasure(ingredient, amount, units, formatQuantity) {
	if (!Number.isFinite(amount))
		return { quantity: "Not specified", status: "unspecified" };
	if (amount === 0) return { quantity: "to taste", status: "to-taste" };
	const original = `${amount < 0.02 ? measureNumber(amount) : formatQuantity(amount)}${ingredient.unit ? ` ${ingredient.unit}` : ""}`;
	const weight = ingredientWeight(ingredient);
	const mass = MASS_GRAMS[ingredient.unit];
	const volume = VOLUME_ML[ingredient.unit];
	// A cooker's minimum liquid is a volume requirement; density estimates cannot replace it.
	if (ingredient.scale === "minimum" && ingredient.unit === "ml")
		return {
			quantity: `${measureNumber(amount * volume)} mL minimum (measure by volume)`,
			status: "minimum-volume",
		};
	if (units === "us") {
		if (mass) {
			const grams = amount * mass;
			const unit = grams >= MASS_GRAMS.lb ? "lb" : "oz";
			return {
				quantity: `${measureNumber(grams / MASS_GRAMS[unit], 2)} ${unit}`,
				status: "mass",
				source: weight.source,
			};
		}
		if (ingredient.unit === "ml")
			return {
				quantity: `${measureNumber(amount / VOLUME_ML["fl oz"], 2)} fl oz`,
				status: "volume",
			};
		return { quantity: original, status: volume ? "volume" : "source-measure" };
	}
	if (mass)
		return {
			quantity: `${measureNumber(amount * mass)} g`,
			status: "mass",
			source: weight.source,
		};
	if (units === "metric" && volume && (weight?.kind === "liquid" || !weight)) {
		return {
			quantity: `${measureNumber(amount * volume)} mL${ingredient.unit === "ml" ? "" : ` volume (${original})`}`,
			status: "volume",
		};
	}
	if (weight)
		return {
			quantity: `~${measureNumber(amount * weight.gramsPerUnit)} g${weight.basis ? ` ${weight.basis}` : ""} (${original})`,
			status: "approximate-mass",
			source: weight.source,
		};
	return {
		quantity: `${original} (weight unavailable)`,
		status: "source-measure",
	};
}
