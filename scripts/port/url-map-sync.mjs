// Adds the legacy URL map rows that awesome-blog content at
// `freeze_sha ?? cut_sha` needs and the map lacks (plan §5 B01, run at C0):
//
//   node scripts/port/url-map-sync.mjs
//
// - The URLs come from the content entries of path-map.mjs: published posts
//   (`draft: false`; a missing `draft` defaults to true), categories, recipe
//   ids and media files each need a redirect-301 row from their old path to
//   its jsolly.com home.
// - Each new row goes at the end of url-map.json with the next id of its
//   prefix; ids are frozen, so nothing is renumbered.
// - url-union.json gains the path and, for a page, its served `/index.html`
//   form, so the cutover verifier probes both.
// - Rows are never removed or edited. A new path that an existing row already
//   answers without redirecting (an exact stays-404 or serve-200 row, or any
//   pattern row, compiled as Vercel compiles it) fails the run: content now
//   exists there and the decision is John's.
// - meta.freeze_sha takes source.json's freeze_sha once C0 sets it.
//
// Run `npm run redirects:write` afterwards to regenerate vercel.json.
import { isDeepStrictEqual } from "node:util";
import { sourceToRegex } from "@vercel/routing-utils";
import {
	formatJson,
	groupsOf,
	parseCli,
	readLegacy,
	readSource,
	runCli,
	sourceSha,
	srcBlob,
	srcFiles,
	URL_MAP,
	URL_UNION,
	writeDstFile,
} from "./lib.mjs";
import { contentMappings } from "./path-map.mjs";

const ROW_ID = /^(?<prefix>[A-Z]+)-(?<number>\d+)$/u;

// The legacy URLs the content at `sha` publishes, in path-map order.
function neededRows(src, sha) {
	return contentMappings(srcFiles(src, sha)).flatMap(({ from, rest, entry }) =>
		entry.legacy
			? entry.legacy(rest, () => srcBlob(src, sha, from).toString("utf8"))
			: [],
	);
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

// The existing non-redirect row that already answers `path`, if any.
function blockingRow(rows, patterns, path) {
	return (
		rows.find(
			(row) =>
				row.match === "exact" &&
				row.source === path &&
				row.action !== "redirect-301",
		) ?? patterns.find(({ regex }) => regex.test(path))?.row
	);
}

function syncMap({ map, union, needed, sha, freezeSha }) {
	const rows = [...map.rows];
	const elements = [...union.elements];
	const bySource = new Map(rows.map((row) => [row.source, row]));
	const known = new Set(elements.map((element) => element.path));
	const patterns = rows
		.filter((row) => row.match === "pattern")
		.map((row) => ({
			row,
			regex: new RegExp(sourceToRegex(row.source).src, "u"),
		}));
	const nextId = nextIds(rows);
	const added = { rows: [], paths: [] };
	for (const item of needed) {
		const existing = bySource.get(item.source);
		const newPaths = item.paths.filter((path) => !known.has(path));
		// A source that already redirects is settled; anything else is checked.
		const checked =
			existing?.action === "redirect-301"
				? newPaths
				: [item.source, ...newPaths];
		const blocked = checked
			.map((path) => ({ path, row: blockingRow(rows, patterns, path) }))
			.find((candidate) => candidate.row !== undefined);
		if (blocked) {
			throw new Error(
				`${blocked.row.id} (${blocked.row.source}, ${blocked.row.action}) already answers ${blocked.path}, but awesome-blog@${sha.slice(0, 10)} has content there; decide the row by hand`,
			);
		}
		let row = existing;
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
		for (const path of newPaths) {
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
	// The never-remove guarantee, checked rather than assumed.
	if (
		!isDeepStrictEqual(rows.slice(0, map.rows.length), map.rows) ||
		!union.elements.every((element) =>
			elements.some((other) => isDeepStrictEqual(other, element)),
		)
	) {
		throw new Error("url-map-sync would change or drop an existing entry");
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
	const { src, dst } = parseCli(argv, { locations: ["src", "dst"] });
	const source = readSource(dst);
	const sha = sourceSha(source);
	const synced = syncMap({
		map: readLegacy(dst, "url-map.json"),
		union: readLegacy(dst, "url-union.json"),
		needed: neededRows(src, sha),
		sha,
		freezeSha: source.freeze_sha,
	});
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
