// Content Security Policy helpers shared by the header unit test and the
// build-time check of dist/. Vercel sends the vercel.json header policy and
// Astro writes a per-page meta policy; browsers enforce both.
import fs from "node:fs/promises";

const VERCEL_CONFIG = new URL("../vercel.json", import.meta.url);
const WHITESPACE = /\s+/u;

// The response header policy that vercel.json applies to every route. Exactly
// one Content-Security-Policy may exist and it must cover every route: a
// second, route-scoped policy would be enforced by browsers without the review
// these tests pin.
export async function readHeaderPolicy() {
	const vercel = JSON.parse(await fs.readFile(VERCEL_CONFIG, "utf8"));
	const policies = vercel.headers.flatMap((entry) =>
		entry.headers
			.filter(
				(header) => header.key.toLowerCase() === "content-security-policy",
			)
			.map((header) => ({ source: entry.source, value: header.value })),
	);
	if (policies.length !== 1 || policies[0].source !== "/(.*)") {
		throw new Error(
			`vercel.json must send exactly one Content-Security-Policy, on source "/(.*)"; found ${JSON.stringify(policies.map((policy) => policy.source))}`,
		);
	}
	return policies[0].value;
}

// Directive name (lowercased, as browsers match it) to its source list.
// Browsers ignore a repeated directive, so a duplicate throws instead of being
// silently dropped.
export function parseDirectives(policy) {
	const directives = new Map();
	for (const entry of policy.split(";")) {
		const [rawName, ...sources] = entry.trim().split(WHITESPACE);
		if (!rawName) continue;
		const name = rawName.toLowerCase();
		if (directives.has(name)) {
			throw new Error(
				`${name} appears twice; browsers ignore a repeated directive`,
			);
		}
		directives.set(name, sources);
	}
	return directives;
}
