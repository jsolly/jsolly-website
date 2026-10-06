import { temperature } from "./recipe-logic.mjs";

const fractions = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅛": 0.125 };
const INCHES = /^(?<whole>\d*)(?<fraction>[¼½¾⅛])?$/u;
const FAHRENHEIT = /(?<degrees>\d+)°F/gu;
const DIMENSIONS =
	/(?<a>\d+(?:\.\d+)?[¼½¾⅛]?|[¼½¾⅛])×(?<b>\d+(?:\.\d+)?[¼½¾⅛]?|[¼½¾⅛])(?:-inch| inches)/gu;
const LENGTH =
	/(?<![\d×])(?:\d+(?:\.\d+)?[¼½¾⅛]?|[¼½¾⅛])(?:-inch| inches| inch)\b/gu;
const LENGTH_UNIT_SEPARATOR = /[- ]/u;

function inches(value) {
	if (!INCHES.test(value)) return Number(value);
	const { whole, fraction } = INCHES.exec(value).groups;
	return Number(whole || 0) + (fractions[fraction] || 0);
}
/** Convert display geometry only. Preserve the original setting and safe endpoint. */
export function cookText(text, units = "us") {
	if (units !== "metric") return text;
	return text
		.replace(FAHRENHEIT, (_, f) =>
			temperature(Number(f), "metric", [145, 160, 165].includes(Number(f))),
		)
		.replace(
			DIMENSIONS,
			(original, a, b) =>
				`${Number((inches(a) * 2.54).toFixed(2))}×${Number((inches(b) * 2.54).toFixed(2))} cm (${original})`,
		)
		.replace(LENGTH, (original) => {
			if (original.includes("×")) return original;
			const value = original.split(LENGTH_UNIT_SEPARATOR)[0];
			return `${Number((inches(value) * 2.54).toFixed(2))} cm (${original})`;
		});
}
