// RFC 9116 security.txt checks shared by the jsolly.com built test and the
// legacy host's unit test, so both hosts' files meet one bar.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DAY_MS = 86_400_000;
const FIELD = /^(?<name>[A-Za-z-]+): (?<value>\S.*)$/u;
const RFC3339 =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

// HEAD's commit date. In the pre-commit hook HEAD is the parent of the commit
// being made.
function headCommitDate() {
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
// HEAD's commit date and less than 365 days after it. Measuring from the
// commit, not from today, keeps the check hermetic; the future-date check
// runs daily outside the gate.
export function securityTxtProblems(text, expected) {
	const problems = [];
	const fields = [];
	for (const line of text.split("\n")) {
		if (line === "" || line.startsWith("#")) continue;
		if (!FIELD.test(line)) {
			problems.push(`line "${line}" is not a field`);
			continue;
		}
		const { name, value } = FIELD.exec(line).groups;
		fields.push([name.toLowerCase(), value]);
	}
	const values = (name) =>
		fields.filter(([field]) => field === name).map(([, value]) => value);
	for (const [name, value] of Object.entries(expected)) {
		const found = values(name);
		if (found.length !== 1 || found[0] !== value) {
			problems.push(`${name} is ${JSON.stringify(found)}, not ["${value}"]`);
		}
	}
	const expires = values("expires");
	if (expires.length !== 1 || !RFC3339.test(expires[0])) {
		problems.push(
			`Expires is ${JSON.stringify(expires)}, not one RFC 3339 time`,
		);
		return problems;
	}
	const committed = headCommitDate();
	const lifetime = Date.parse(expires[0]) - Date.parse(committed);
	if (lifetime <= 0) {
		problems.push(
			`Expires ${expires[0]} is not after HEAD's commit date ${committed}`,
		);
	} else if (lifetime >= 365 * DAY_MS) {
		problems.push(
			`Expires ${expires[0]} is 365 days or more after HEAD's commit date ${committed}`,
		);
	}
	return problems;
}
