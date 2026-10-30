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

// Labels describe explicit observed portions, never inferred food identities.
const PORTION_LABELS = {
	head: ["head", "heads"],
	bunch: ["bunch", "bunches"],
	slice: ["slice", "slices"],
	fillet: ["fillet", "fillets"],
	clove: ["clove", "cloves"],
	stalk: ["stalk", "stalks"],
	spear: ["spear", "spears"],
	strip: ["strip", "strips"],
	cube: ["cube", "cubes"],
	packet: ["packet", "packets"],
	stick: ["stick", "sticks"],
};

function portionMeasure(ingredient, grams, formatQuantity) {
	const ref = ingredient.weightReference;
	if (!ref) return null;
	const unit =
		ref.displayPortion?.unit ||
		Object.keys(PORTION_LABELS).find((key) => ref.measures[key]);
	if (!unit) return null;
	const observed = ref.measures[unit];
	if (!positive(observed?.grams) || !positive(observed?.amount))
		invalid(ingredient, `invalid household display portion in ${ref.id}`);
	const count = grams / (observed.grams / observed.amount);
	const names = ref.displayPortion || {
		singular: PORTION_LABELS[unit][0],
		plural: PORTION_LABELS[unit][1],
	};
	const exact =
		ingredient.unit === unit ||
		(ingredient.unit === "count" &&
			["count", "clove", "lemon", "lime"].includes(unit));
	if (!exact && count < 1 / 8) return null;
	const portions = [
		1 / 8,
		1 / 6,
		1 / 4,
		1 / 3,
		3 / 8,
		1 / 2,
		5 / 8,
		2 / 3,
		3 / 4,
		5 / 6,
		7 / 8,
	];
	const whole = Math.floor(count);
	const candidates = [
		whole,
		...portions.map((fraction) => whole + fraction),
		whole + 1,
	].filter(positive);
	const rounded = exact
		? count
		: count >= 5
			? Math.round(count)
			: candidates.reduce((best, candidate) =>
					Math.abs(candidate - count) < Math.abs(best - count)
						? candidate
						: best,
				);
	const shown =
		!exact && Math.abs(rounded - count) / count <= 0.15 ? rounded : count;
	return {
		quantity: `${names.prefix || ""}${exact ? "" : "about "}${formatQuantity(shown)} ${unit === "can" && shown < 1 ? (names.singular.startsWith("8 ") ? "of an " : "of a ") : ""}${shown <= 1 ? names.singular : names.plural}`,
		status: "portion",
	};
}

function spoonMeasure(ingredient, grams, formatQuantity) {
	const ref = ingredient.weightReference;
	if (!ref) return null;
	const quantities = ["cup", "tbsp", "tsp"].flatMap((unit) => {
		const direct = ref.measures[unit];
		if (positive(direct?.grams) && positive(direct?.amount))
			return [{ unit, amount: grams / (direct.grams / direct.amount) }];
		const basis = ref.volumeInterpolationUnit;
		const observation = ref.measures[basis];
		if (
			basis &&
			positive(observation?.grams) &&
			positive(observation?.amount) &&
			VOLUME_ML[basis]
		) {
			const gramsPerMl =
				observation.grams / observation.amount / VOLUME_ML[basis];
			return [{ unit, amount: grams / gramsPerMl / VOLUME_ML[unit] }];
		}
		if (ref.kind === "liquid" && positive(ref.gramsPerMl))
			return [{ unit, amount: grams / ref.gramsPerMl / VOLUME_ML[unit] }];
		return [];
	});
	if (!quantities.length) return null;
	const choice =
		quantities.find(
			({ unit, amount }) =>
				(unit === "cup" && amount >= 0.25) || (unit === "tbsp" && amount >= 1),
		) || quantities.at(-1);
	const whole = Math.floor(choice.amount);
	const candidates = [
		whole,
		...[
			1 / 8,
			1 / 6,
			1 / 4,
			1 / 3,
			3 / 8,
			1 / 2,
			5 / 8,
			2 / 3,
			3 / 4,
			5 / 6,
			7 / 8,
			1,
		].map((fraction) => whole + fraction),
	].filter(positive);
	const nearest = candidates.reduce((best, value) =>
		Math.abs(value - choice.amount) < Math.abs(best - choice.amount)
			? value
			: best,
	);
	const approximate =
		Math.abs(nearest - choice.amount) > 1e-9 &&
		Math.abs(nearest - choice.amount) / choice.amount <= 0.1;
	return {
		quantity: `${approximate ? "about " : ""}${formatQuantity(approximate ? nearest : choice.amount)} ${choice.unit}`,
		status: "volume",
	};
}

/** Show useful household, whole-gram and customary equivalents from one exact mass. */
export function ingredientMeasure(ingredient, amount, _units, formatQuantity) {
	const grams = ingredientGrams(ingredient, amount);
	const weight = ingredientWeight(ingredient);
	const portion = portionMeasure(ingredient, grams, formatQuantity);
	const spoon = portion
		? null
		: spoonMeasure(ingredient, grams, formatQuantity);
	const measurements = [];
	if (grams < 1) {
		measurements.push({ quantity: "A pinch", status: "portion" });
	} else {
		if (portion || spoon) measurements.push(portion ?? spoon);
		measurements.push({ quantity: `${Math.round(grams)} g`, status: "mass" });
		if (weight.kind === "liquid") {
			const volume = VOLUME_ML[ingredient.unit];
			const ml = volume
				? amount * volume
				: positive(weight.gramsPerMl)
					? grams / weight.gramsPerMl
					: null;
			if (!positive(ml))
				invalid(
					ingredient,
					"liquid mass or portion needs an explicit gramsPerMl",
				);
			measurements.push({
				quantity: `${measureNumber(ml)} mL`,
				status: "volume",
			});
			if (measurements.length < 3)
				measurements.push({
					quantity: `${measureNumber(ml / VOLUME_ML["fl oz"], 2)} fl oz`,
					status: "volume",
				});
		} else {
			const unit = grams >= MASS_GRAMS.lb ? "lb" : "oz";
			measurements.push({
				quantity: `${measureNumber(grams / MASS_GRAMS[unit], 2)} ${unit}`,
				status: "mass",
			});
		}
	}
	const result = {
		quantity: measurements.map(({ quantity }) => quantity).join(" / "),
		measurements,
		status: measurements.length > 1 ? "multiple" : measurements[0].status,
		grams,
		source: weight.source,
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
				_units,
				formatQuantity,
			),
		}));
	}
	return result;
}
