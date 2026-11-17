// Content Security Policy helpers shared by the header unit test and the
// build-time check of dist/. Vercel sends the vercel.ts header policy and
// Astro writes a per-page meta policy; browsers enforce both.
import { siteHeaderPolicy } from "../src/lib/csp-policy.ts";
import { config } from "../vercel.ts";

const WHITESPACE = /\s+/u;

// The header policy of the repo's vercel.ts (siteHeaderPolicy owns its rules).
export function readHeaderPolicy() {
	return siteHeaderPolicy(config);
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
