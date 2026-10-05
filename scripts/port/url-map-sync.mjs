// Adds the legacy URL map rows that awesome-blog content at
// `freeze_sha ?? cut_sha` needs and the map lacks (plan §5 B01, run at C0):
//
//   node scripts/port/url-map-sync.mjs
//
// - Published posts (`draft: false`; a missing `draft` defaults to true, as
//   the collection schema does), categories, recipe ids and media files each
//   need a redirect-301 row from their old path to its jsolly.com home.
// - Each new row goes at the end of url-map.json with the next id of its
//   prefix; ids are frozen, so nothing is renumbered.
// - url-union.json gains the path and, for a page, its served `/index.html`
//   form, so the cutover verifier probes both.
// - Rows are never removed or edited. A path whose existing row does not
//   redirect (stays-404, serve-200) fails the run, since content now exists
//   there and the decision is John's.
// - meta.freeze_sha takes source.json's freeze_sha once C0 sets it.
//
// Run `npm run redirects:write` afterwards to regenerate vercel.json.
import { isDeepStrictEqual } from "node:util";
import { JSOLLY_ORIGIN } from "../blogthedata-redirects.mjs";
import {
	formatJson,
	groupsOf,
	parseCli,
	readDstJson,
	readSource,
	runCli,
	sourceSha,
	srcBlob,
	srcFiles,
	writeDstFile,
} from "./lib.mjs";

const URL_MAP = "legacy/blogthedata/url-map.json";
const URL_UNION = "legacy/blogthedata/url-union.json";
const POST = /^src\/content\/posts\/(?<slug>[^/.][^/]*)\.md$/u;
const CATEGORY = /^src\/content\/categories\/(?<slug>[^/]+)\.json$/u;
const RECIPE_MEDIA = /^public\/media\/recipes\/(?<file>[^/]+)$/u;
const BLOG_MEDIA = /^public\/media\/(?<file>(?!recipes\/).+)$/u;
const RECIPES_JSON = "src/components/recipes/recipes.json";
const FRONTMATTER = /^---\n(?<yaml>[\s\S]*?)\n---(?:\n|$)/u;
const DRAFT = /^draft:[ \t]*(?<value>[^#\n]*?)[ \t]*(?:#.*)?$/mu;
const YAML_FALSE = new Set(["false", "False", "FALSE"]);
const YAML_TRUE = new Set(["true", "True", "TRUE"]);
const ROW_ID = /^(?<prefix>[A-Z]+)-(?<number>\d+)$/u;

// Whether a post at `sha` is published. Anything but a YAML boolean fails.
function isPublished(path, text) {
	const yaml = groupsOf(FRONTMATTER, text)?.yaml;
	if (yaml === undefined) {
		throw new Error(`${path} has no frontmatter`);
	}
	const value = groupsOf(DRAFT, yaml)?.value;
	if (value === undefined || YAML_TRUE.has(value)) {
		return false;
	}
	if (YAML_FALSE.has(value)) {
		return true;
	}
	throw new Error(`${path}: cannot read draft: ${value}`);
}

// The content at `sha` as the rows it needs, in a stable order.
function neededRows(src, sha) {
	const files = srcFiles(src, sha);
	const needed = [];
	const page = (prefix, rowClass, slashPath, destinationPath) => ({
		prefix,
		class: rowClass,
		source: slashPath,
		destination: `${JSOLLY_ORIGIN}${destinationPath}`,
		paths: [slashPath, `${slashPath}index.html`],
	});
	for (const path of files) {
		const post = groupsOf(POST, path)?.slug;
		if (
			post !== undefined &&
			isPublished(path, srcBlob(src, sha, path).toString("utf8"))
		) {
			needed.push(page("PST", "post", `/post/${post}/`, `/blog/${post}/`));
		}
	}
	for (const path of files) {
		const category = groupsOf(CATEGORY, path)?.slug;
		if (category !== undefined) {
			needed.push(
				page(
					"CAT",
					"category",
					`/category/${category}/`,
					`/blog/category/${category}/`,
				),
			);
		}
	}
	if (files.includes(RECIPES_JSON)) {
		const { recipes } = JSON.parse(
			srcBlob(src, sha, RECIPES_JSON).toString("utf8"),
		);
		for (const id of recipes.map((recipe) => recipe.id).sort()) {
			needed.push(
				page("RCP", "recipe-page", `/recipes/${id}/`, `/recipes/${id}/`),
			);
		}
	}
	for (const path of files) {
		const recipeFile = groupsOf(RECIPE_MEDIA, path)?.file;
		const blogFile = groupsOf(BLOG_MEDIA, path)?.file;
		const [source, destination] = recipeFile
			? [`/media/recipes/${recipeFile}`, `/recipes/media/${recipeFile}`]
			: [`/media/${blogFile}`, `/blog/media/${blogFile}`];
		if (recipeFile !== undefined || blogFile !== undefined) {
			needed.push({
				prefix: "MED",
				class: "asset-media",
				source,
				destination: `${JSOLLY_ORIGIN}${destination}`,
				paths: [source],
			});
		}
	}
	return needed;
}

function nextIds(rows) {
	const highest = new Map();
	for (const row of rows) {
		const { prefix, number } = groupsOf(ROW_ID, row.id) ?? {};
		if (prefix !== undefined) {
			highest.set(prefix, Math.max(highest.get(prefix) ?? 0, Number(number)));
		}
	}
	return (prefix) => {
		const next = (highest.get(prefix) ?? 0) + 1;
		highest.set(prefix, next);
		return `${prefix}-${String(next).padStart(3, "0")}`;
	};
}

// Path elements stay sorted by path, after the host rule and before the
// Django route templates, as the PA6 union was written.
function insertElement(elements, element) {
	const index = elements.findIndex(
		(other) =>
			other.kind === "template" ||
			(other.kind === "path" && other.path > element.path),
	);
	elements.splice(index === -1 ? elements.length : index, 0, element);
}

export function syncMap({ map, union, needed, sha, freezeSha }) {
	const rows = [...map.rows];
	const elements = [...union.elements];
	const bySource = new Map(rows.map((row) => [row.source, row]));
	const known = new Set(elements.map((element) => element.path));
	const nextId = nextIds(rows);
	const added = { rows: [], paths: [] };
	for (const item of needed) {
		let row = bySource.get(item.source);
		if (row && row.action !== "redirect-301") {
			throw new Error(
				`${row.id} ${row.source} is ${row.action}, but awesome-blog@${sha.slice(0, 10)} has content there; decide the row by hand`,
			);
		}
		if (!row) {
			row = {
				id: nextId(item.prefix),
				source: item.source,
				match: "exact",
				class: item.class,
				action: "redirect-301",
				destination: item.destination,
				evidence: ["build"],
				decision_ref: null,
				notes: `Added by scripts/port/url-map-sync.mjs from awesome-blog@${sha}.`,
			};
			rows.push(row);
			bySource.set(row.source, row);
			added.rows.push(row);
		}
		for (const path of item.paths.filter(
			(candidate) => !known.has(candidate),
		)) {
			insertElement(elements, {
				kind: "path",
				path,
				probe: path,
				row_id: row.id,
				queries: [],
				hosts: [],
				served_today: true,
				evidence: [path.endsWith("/index.html") ? "served" : "build"],
			});
			known.add(path);
			added.paths.push(path);
		}
	}
	const meta =
		freezeSha === null ? map.meta : { ...map.meta, freeze_sha: freezeSha };
	return {
		map: { ...map, meta, rows },
		union: { ...union, elements },
		added,
	};
}

function main(argv) {
	const { src, dst } = parseCli(argv);
	const source = readSource(dst);
	const sha = sourceSha(source);
	const map = readDstJson(dst, URL_MAP);
	const union = readDstJson(dst, URL_UNION);
	const synced = syncMap({
		map,
		union,
		needed: neededRows(src, sha),
		sha,
		freezeSha: source.freeze_sha,
	});
	// The never-remove guarantee, checked rather than assumed.
	if (
		!isDeepStrictEqual(synced.map.rows.slice(0, map.rows.length), map.rows) ||
		!union.elements.every((element) =>
			synced.union.elements.some((other) => isDeepStrictEqual(other, element)),
		)
	) {
		throw new Error("url-map-sync would change or drop an existing entry");
	}
	writeDstFile(dst, URL_MAP, formatJson(URL_MAP, synced.map));
	writeDstFile(dst, URL_UNION, formatJson(URL_UNION, synced.union));
	console.log(
		`✓ url map synced to awesome-blog@${sha.slice(0, 10)}: ${synced.added.rows.length} rows and ${synced.added.paths.length} union paths added; meta.freeze_sha ${synced.map.meta.freeze_sha ?? "null"}.`,
	);
	for (const row of synced.added.rows) {
		console.log(`  ${row.id} ${row.source} -> ${row.destination}`);
	}
	for (const path of synced.added.paths) {
		console.log(`  union ${path}`);
	}
	return 0;
}

runCli(import.meta.url, main);
