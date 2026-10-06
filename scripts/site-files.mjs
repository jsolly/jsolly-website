// Readers and checks for the plain-text site files, robots.txt and RFC 9116
// security.txt, shared by the jsolly.com built tests and the legacy host's
// unit test, so both hosts' files meet one bar.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DAY_MS = 86_400_000;
// The one `Name: value` line form both files use (RFC 9116 requires the
// single space; RFC 9309 robots.txt allows it).
const FIELD = /^(?<name>[A-Za-z-]+): (?<value>\S.*)$/u;
const RFC3339 =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

// `text` as { fields: [lowercase name, value] pairs in file order, unparsed:
// the lines that are neither blank, a `#` comment nor a field }.
export function fieldLines(text) {
	const lines = { fields: [], unparsed: [] };
	for (const line of text.split("\n")) {
		if (line === "" || line.startsWith("#")) continue;
		if (!FIELD.test(line)) {
			lines.unparsed.push(line);
			continue;
		}
		const { name, value } = FIELD.exec(line).groups;
		lines.fields.push([name.toLowerCase(), value]);
	}
	return lines;
}

// The values of field `name` (lowercase) in fieldLines() `fields`.
export function fieldValues(fields, name) {
	return fields.filter(([field]) => field === name).map(([, value]) => value);
}

// HEAD's commit date (`git log -1 --format=%cI`). In the pre-commit hook HEAD
// is the parent of the commit being made.
export function headCommitDate() {
	const committed = spawnSync("git", ["log", "-1", "--format=%cI"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	if (committed.status !== 0) {
		throw new Error(`git log failed: ${committed.stderr}`);
	}
	return committed.stdout.trim();
}

// What is wrong with security.txt `text`, as messages (none when it is
// valid): a line that is not blank, a comment or a field; a field in
// `expected` (lowercase names) that does not appear exactly once with that
// value; or an Expires that does not appear once as an RFC 3339 time after
// `committed` and less than 365 days after it. Callers pass HEAD's commit
// date, not today, which keeps the check hermetic; the future-date check
// will run daily in legacy-redirects.yml (cutover C2 step 8), outside the
// gate.
export function securityTxtProblems(text, expected, { committed }) {
	const { fields, unparsed } = fieldLines(text);
	const problems = unparsed.map((line) => `line "${line}" is not a field`);
	for (const [name, value] of Object.entries(expected)) {
		const found = fieldValues(fields, name);
		if (found.length !== 1 || found[0] !== value) {
			problems.push(`${name} is ${JSON.stringify(found)}, not ["${value}"]`);
		}
	}
	const expires = fieldValues(fields, "expires");
	if (expires.length !== 1 || !RFC3339.test(expires[0])) {
		problems.push(
			`Expires is ${JSON.stringify(expires)}, not one RFC 3339 time`,
		);
		return problems;
	}
	const lifetime = Date.parse(expires[0]) - Date.parse(committed);
	if (lifetime <= 0) {
		problems.push(`Expires ${expires[0]} is not after ${committed}`);
	} else if (lifetime >= 365 * DAY_MS) {
		problems.push(
			`Expires ${expires[0]} is 365 days or more after ${committed}`,
		);
	}
	return problems;
}
