/**
 * RFC 9110 Accept negotiation for HTML vs Markdown (acceptmarkdown.com).
 * Edge-safe: no Node APIs.
 */

export const PRODUCES = ["text/html", "text/markdown"] as const;
export type ProducedType = (typeof PRODUCES)[number];

type AcceptEntry = { type: string; q: number; specificity: number };

export function parseAccept(header: string): AcceptEntry[] {
	return header.split(",").map((raw) => {
		const parts = raw
			.trim()
			.split(";")
			.map((s) => s.trim());
		const type = (parts[0] ?? "").toLowerCase();
		let q = 1;
		for (const param of parts.slice(1)) {
			const [name, value] = param.split("=").map((s) => s.trim());
			if (name === "q") {
				const parsed = Number(value);
				if (!Number.isNaN(parsed)) q = Math.max(0, Math.min(1, parsed));
			}
		}
		const specificity = type === "*/*" ? 0 : type.endsWith("/*") ? 1 : 2;
		return { type, q, specificity };
	});
}

function matches(entry: AcceptEntry, candidate: string): boolean {
	if (entry.type === "*/*") return true;
	if (entry.type.endsWith("/*")) {
		return candidate.startsWith(entry.type.slice(0, -1));
	}
	return entry.type === candidate;
}

/** Best produced type, or null when every candidate is rejected / unmatched. */
export function preferredType(header: string | null): ProducedType | null {
	if (!header || header.trim() === "") return PRODUCES[0];
	const entries = parseAccept(header);
	if (entries.length === 0) return PRODUCES[0];

	let best: ProducedType | null = null;
	let bestQ = -1;
	let bestPosition = Number.POSITIVE_INFINITY;

	for (const candidate of PRODUCES) {
		let matched: AcceptEntry | null = null;
		let matchedPosition = Number.POSITIVE_INFINITY;
		for (let idx = 0; idx < entries.length; idx++) {
			const e = entries[idx];
			if (!e || !matches(e, candidate)) continue;
			if (
				matched === null ||
				e.specificity > matched.specificity ||
				(e.specificity === matched.specificity && idx < matchedPosition)
			) {
				matched = e;
				matchedPosition = idx;
			}
		}
		if (matched === null) continue;
		if (matched.q <= 0) continue;
		if (
			matched.q > bestQ ||
			(matched.q === bestQ && matchedPosition < bestPosition)
		) {
			bestQ = matched.q;
			bestPosition = matchedPosition;
			best = candidate;
		}
	}

	return best;
}

export function appendVaryAccept(headers: Headers): void {
	const existing = headers.get("Vary");
	if (!existing) {
		headers.set("Vary", "Accept");
		return;
	}
	const tokens = existing.split(",").map((s) => s.trim().toLowerCase());
	if (!tokens.includes("accept")) {
		headers.set("Vary", `${existing}, Accept`);
	}
}

const MARKDOWN_FILE_RE = /\.md$/i;
const STATIC_EXT_RE =
	/\.(?:js|css|png|jpe?g|gif|webp|svg|ico|pdf|xml|txt|woff2?|map|webmanifest|json)$/i;

export function shouldNegotiate(pathname: string, method: string): boolean {
	const verb = method.toUpperCase();
	if (verb !== "GET" && verb !== "HEAD") return false;
	if (
		pathname.startsWith("/_astro/") ||
		pathname.startsWith("/favicons/") ||
		pathname.startsWith("/images/") ||
		pathname.startsWith("/scripts/")
	) {
		return false;
	}
	if (MARKDOWN_FILE_RE.test(pathname)) return true;
	if (STATIC_EXT_RE.test(pathname)) return false;
	return true;
}

/** Canonical page key: `/`, `/about`, `/contact`, `/privacy`. */
export function normalizePagePath(pathname: string): string {
	const isMarkdownSibling = /\.md(?:\/+)?$/i.test(pathname);
	let path = pathname.replace(/\/+$/, "") || "/";
	if (/\.md$/i.test(path)) {
		path = path.replace(/\.md$/i, "");
		path = path.replace(/\/+$/, "") || "/";
	}
	if (isMarkdownSibling && (path === "/index" || path === "")) return "/";
	return path || "/";
}

export function markdownSiblingPath(pathname: string): string {
	const key = normalizePagePath(pathname);
	return key === "/" ? "/index.md" : `${key}.md`;
}
