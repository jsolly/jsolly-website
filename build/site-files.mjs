// Readers and checks for the plain-text site files, robots.txt and RFC 9116
// security.txt, shared by the jsolly.com tests and the legacy host's unit
// test, so both hosts' files meet one bar.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DAY_MS = 86_400_000;
// The one `Name: value` line form both files use (RFC 9116 requires the
// single space; RFC 9309 robots.txt allows it).
const FIELD = /^(?<name>[A-Za-z-]+): (?<value>\S.*)$/u;
const RFC3339 =
	/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

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

// `text` (already RFC 3339 shaped) as epoch milliseconds, or NaN for an
// impossible time. Date.parse rejects month 13 and hour 25 but rolls a day
// past the month's end (02-30) into the next month, so the day is checked
// against the month's length too.
function rfc3339Time(text) {
	const { year, month, day } = RFC3339.exec(text).groups;
	const monthDays = new Date(Date.UTC(Number(year), Number(month), 0));
	return Number(day) > monthDays.getUTCDate() ? Number.NaN : Date.parse(text);
}

// The one Expires of security.txt `fields` (fieldLines() `fields`) as
// { text, time }, time in epoch milliseconds and NaN for an impossible date;
// null when Expires is missing, repeated or not RFC 3339 shaped. The cutover
// verifier reads the live files' Expires with it too.
export function securityTxtExpires(fields) {
	const expires = fieldValues(fields, "expires");
	if (expires.length !== 1 || !RFC3339.test(expires[0])) {
		return null;
	}
	return { text: expires[0], time: rfc3339Time(expires[0]) };
}

// What is wrong with security.txt `text`, as messages (none when it is
// valid): a line that is not blank, a comment or a field; a field in
// `expected` (lowercase names) that does not appear exactly once with that
// value; any other field but Expires; or an Expires that does not appear
// once as a valid RFC 3339 time after `committed` and less than 365 days
// after it. Callers pass HEAD's commit date, not today, which keeps the
// check hermetic; the future-date check will run daily in
// legacy-redirects.yml (cutover C2 step 8), outside the gate. Throws when
// `committed` is not a time.
export function securityTxtProblems(text, expected, { committed }) {
	const committedAt = Date.parse(committed);
	if (Number.isNaN(committedAt)) {
		throw new Error(`committed ${JSON.stringify(committed)} is not a time`);
	}
	const { fields, unparsed } = fieldLines(text);
	const problems = unparsed.map((line) => `line "${line}" is not a field`);
	for (const [name, value] of Object.entries(expected)) {
		const found = fieldValues(fields, name);
		if (found.length !== 1 || found[0] !== value) {
			problems.push(`${name} is ${JSON.stringify(found)}, not ["${value}"]`);
		}
	}
	for (const [name, value] of fields) {
		if (name !== "expires" && !Object.hasOwn(expected, name)) {
			problems.push(`unexpected field ${name}: ${value}`);
		}
	}
	const expires = securityTxtExpires(fields);
	if (!expires) {
		problems.push(
			`Expires is ${JSON.stringify(fieldValues(fields, "expires"))}, not one RFC 3339 time`,
		);
		return problems;
	}
	const lifetime = expires.time - committedAt;
	if (Number.isNaN(lifetime)) {
		problems.push(`Expires ${expires.text} is not a valid time`);
	} else if (!(lifetime > 0)) {
		problems.push(`Expires ${expires.text} is not after ${committed}`);
	} else if (!(lifetime < 365 * DAY_MS)) {
		problems.push(
			`Expires ${expires.text} is 365 days or more after ${committed}`,
		);
	}
	return problems;
}
