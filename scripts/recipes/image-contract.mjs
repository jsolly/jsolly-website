import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

function requireValid(condition, message) {
	if (!condition) throw new Error(message);
}
function requireEqual(actual, expected, message) {
	requireValid(actual === expected, message);
}
function requireEqualShape(actual, expected, message) {
	requireValid(isDeepStrictEqual(actual, expected), message);
}
function requireMatch(value, expression, message) {
	requireValid(expression.test(value), message);
}

const SRCSET_CANDIDATE = /^(?<path>\S+)\s+(?<width>\d+)w$/u;
const IMAGE_CAPTION =
	/^AI-generated illustration; appearance and portions are approximate\.(?:\s.+)?$/u;
const IMAGE_PATH = /^\/recipes\/media\/[a-z0-9]+(?:-[a-z0-9]+)*-960\.webp$/u;

const publicRoot = fileURLToPath(new URL("../../public/", import.meta.url));

const supportedStyles = new Set(["warm-overhead-v1"]);
const sizes = new Map([
	[480, 360],
	[960, 720],
	[1440, 1080],
]);
const genericWords = new Set(
	"a an and ai all as at basic boneless by cooked count cup cups delicious dish easy food for fresh from generated image illustration in into large lb meal medium of on or ounce ounces oz photo photograph picture plated recipe served serving skinless small some tablespoon tablespoons tasty teaspoon teaspoons the to warm with keto low carb minute minutes".split(
		" ",
	),
);
const words = (value) =>
	new Set(
		String(value)
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.toLowerCase()
			.match(/[a-z]{3,}/gu)
			?.map((word) => (word.endsWith("s") ? word.slice(0, -1) : word))
			.filter((word) => !genericWords.has(word)) ?? [],
	);

/** Inspect the stored WebP canvas rather than trusting filename or JSON dimensions. */
export function webpDimensions(bytes) {
	requireValid(Buffer.isBuffer(bytes) && bytes.length >= 20, "Truncated WebP");
	requireEqual(
		bytes.toString("ascii", 0, 4),
		"RIFF",
		"Asset is not a WebP RIFF container",
	);
	requireEqual(bytes.toString("ascii", 8, 12), "WEBP", "Asset is not WebP");
	requireEqual(
		bytes.readUInt32LE(4) + 8,
		bytes.length,
		"WebP RIFF length does not match file",
	);
	let canvas;
	let pixels;
	for (let offset = 12; offset < bytes.length; ) {
		requireValid(offset + 8 <= bytes.length, "Truncated WebP chunk header");
		const kind = bytes.toString("ascii", offset, offset + 4);
		const length = bytes.readUInt32LE(offset + 4);
		const start = offset + 8;
		requireValid(
			start + length + (length % 2) <= bytes.length,
			"Truncated WebP chunk",
		);
		if (kind === "VP8X") {
			requireEqual(length, 10, "Invalid WebP extended header");
			requireEqual(bytes[start] & 2, 0, "Recipe illustrations must be static");
			canvas = {
				width: bytes.readUIntLE(start + 4, 3) + 1,
				height: bytes.readUIntLE(start + 7, 3) + 1,
			};
		} else if (kind === "VP8 ") {
			requireValid(length >= 10, "Truncated WebP lossy frame");
			requireEqual(
				bytes.subarray(start + 3, start + 6).toString("hex"),
				"9d012a",
				"Invalid WebP lossy frame",
			);
			pixels = {
				width: bytes.readUInt16LE(start + 6) & 0x3fff,
				height: bytes.readUInt16LE(start + 8) & 0x3fff,
			};
		} else if (kind === "VP8L") {
			requireValid(length >= 5, "Truncated WebP lossless frame");
			requireEqual(bytes[start], 0x2f, "Invalid WebP lossless frame");
			const bits = bytes.readUInt32LE(start + 1);
			pixels = {
				width: (bits & 0x3fff) + 1,
				height: ((bits >>> 14) & 0x3fff) + 1,
			};
		} else {
			requireValid(
				!["ANIM", "ANMF"].includes(kind),
				"Recipe illustrations must be static",
			);
		}
		offset = start + length + (length % 2);
	}
	requireValid(
		pixels?.width > 0 && pixels.height > 0,
		"WebP has no image frame",
	);
	if (canvas)
		requireEqualShape(
			canvas,
			pixels,
			"WebP canvas and frame dimensions disagree",
		);
	return canvas ?? pixels;
}

function candidates(srcset, label) {
	requireEqual(typeof srcset, "string", `${label} is required`);
	return srcset.split(",").map((candidate) => {
		const match = candidate.trim().match(SRCSET_CANDIDATE);
		requireValid(match, `${label} must use explicit width descriptors`);
		return { path: match.groups.path, width: Number(match.groups.width) };
	});
}

/** The reader can be injected to exercise missing files and corrupt pixel metadata. */
export function validateRecipeImage(
	recipe,
	{ root = publicRoot, readAsset = readFileSync, cache = new Map() } = {},
) {
	const image = recipe.image;
	requireValid(image && typeof image === "object", "Missing recipe image");
	requireValid(
		supportedStyles.has(image.styleVersion),
		"Unsupported or missing image.styleVersion",
	);
	requireEqual(image.width, 960, "Detail width must be 960");
	requireEqual(image.height, 720, "Detail height must be 720");
	requireEqual(typeof image.alt, "string", "Descriptive image.alt is required");
	requireValid(
		image.alt.trim().length >= 20,
		"Image alt text must describe the dish",
	);
	const subjects = words(
		[
			recipe.title,
			...(recipe.ingredients ?? []).map((ingredient) => ingredient.name),
		].join(" "),
	);
	const matches = [...words(image.alt)].filter((word) => subjects.has(word));
	requireValid(
		matches.length >= 2,
		"Image alt text must name defining foods from this recipe",
	);
	requireMatch(
		image.caption ?? "",
		IMAGE_CAPTION,
		"Image caption must disclose AI illustration and approximate portions",
	);
	requireMatch(
		image.src ?? "",
		IMAGE_PATH,
		"Detail src must be a local 960 WebP",
	);
	const stem = image.src.slice(0, -"-960.webp".length);
	requireEqual(
		image.cardSrc,
		`${stem}-480.webp`,
		"Card src must use the matching 480 WebP",
	);
	const card = candidates(image.cardSrcset, "cardSrcset");
	const detail = candidates(image.detailSrcset, "detailSrcset");
	requireEqualShape(
		card.map((candidate) => candidate.width),
		[480, 960],
		"Card srcset must contain 480w and 960w once, in order",
	);
	requireEqualShape(
		detail.map((candidate) => candidate.width),
		[480, 960, 1440],
		"Detail srcset must contain 480w, 960w and 1440w once, in order",
	);
	for (const candidate of [...card, ...detail]) {
		requireEqual(
			candidate.path,
			`${stem}-${candidate.width}.webp`,
			"Srcset path must match its local image family and width descriptor",
		);
		const path = resolve(root, candidate.path.slice(1));
		if (!cache.has(path)) cache.set(path, webpDimensions(readAsset(path)));
		requireEqualShape(
			cache.get(path),
			{ width: candidate.width, height: sizes.get(candidate.width) },
			`${candidate.path} pixels must match its 4:3 responsive size`,
		);
	}
	return true;
}
