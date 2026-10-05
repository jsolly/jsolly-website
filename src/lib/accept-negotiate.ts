/**
 * RFC 9110 Accept negotiation for HTML vs Markdown (acceptmarkdown.com).
 * Edge-safe: no Node APIs.
 */

const PRODUCES = ["text/html", "text/markdown"] as const;
type ProducedType = (typeof PRODUCES)[number];

type AcceptEntry = { type: string; q: number; specificity: number };

function parseAccept(header: string): AcceptEntry[] {
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

const MARKDOWN_FILE_RE = /\.md$/iu;
// A file extension in the last path segment. Every file other than a `.md`
// sibling is static: the middleware never negotiates or 406s it.
const FILE_EXT_RE = /\.[^./]+$/u;
export const TRAILING_SLASHES_RE = /\/+$/u;
const MARKDOWN_EXT_RE = /\.md$/iu;
const MARKDOWN_SIBLING_RE = /\.md(?:\/+)?$/iu;

const STATIC_DATA_PREFIX = "/recipes/data/";
/**
 * Sections whose real routes serve HTML only (J11). A path in one of them
 * that is not a real route keeps the Markdown 404 that llms.txt promises.
 */
const HTML_ONLY_SECTIONS = ["/blog/", "/recipes/"] as const;

function routeKey(pathname: string): string {
	return pathname.replace(TRAILING_SLASHES_RE, "") || "/";
}

/**
 * Request paths arrive percent-encoded (`/blog/caf%C3%A9/`, `/blog/c%2B%2B/`),
 * while the route manifest lists the decoded paths Astro built. Each segment is
 * decoded fully, reserved characters included; a malformed escape stays raw.
 */
function decodedPath(pathname: string): string {
	try {
		return pathname.split("/").map(decodeURIComponent).join("/");
	} catch {
		return pathname;
	}
}

/**
 * The build's page routes (route manifest, `/about/` style paths), keyed by
 * path without trailing slashes. Matching is case-sensitive, like the routes.
 */
export function routeSet(routes: readonly string[]): ReadonlySet<string> {
	return new Set(routes.map(routeKey));
}

/**
 * A file under /recipes/data/, served as it is even when it ends in `.md`.
 * An extensionless path there is not a file and keeps the Markdown 404.
 */
export function isStaticDataPath(pathname: string): boolean {
	const path = routeKey(pathname);
	return path.startsWith(STATIC_DATA_PREFIX) && FILE_EXT_RE.test(path);
}

/** A real route in an HTML-only section: passed through untouched. */
function isHtmlOnlyRoute(
	pathname: string,
	routes: ReadonlySet<string>,
): boolean {
	const key = routeKey(decodedPath(pathname));
	const inSection = HTML_ONLY_SECTIONS.some((section) =>
		`${key}/`.startsWith(section),
	);
	return inSection && routes.has(key);
}

export function shouldNegotiate(
	pathname: string,
	method: string,
	routes: ReadonlySet<string>,
): boolean {
	const verb = method.toUpperCase();
	if (verb !== "GET" && verb !== "HEAD") return false;
	if (
		pathname.startsWith("/_astro/") ||
		pathname.startsWith("/favicons/") ||
		pathname.startsWith("/images/") ||
		pathname.startsWith("/scripts/") ||
		isStaticDataPath(pathname)
	) {
		return false;
	}
	if (MARKDOWN_FILE_RE.test(pathname)) return true;
	if (FILE_EXT_RE.test(pathname)) return false;
	return !isHtmlOnlyRoute(pathname, routes);
}

/** Canonical page key: `/`, `/about`, `/contact`, `/privacy`, `/terms`. */
export function normalizePagePath(pathname: string): string {
	const isMarkdownSibling = MARKDOWN_SIBLING_RE.test(pathname);
	let path = pathname.replace(TRAILING_SLASHES_RE, "") || "/";
	if (MARKDOWN_EXT_RE.test(path)) {
		path = path.replace(MARKDOWN_EXT_RE, "");
		path = path.replace(TRAILING_SLASHES_RE, "") || "/";
	}
	if (isMarkdownSibling && (path === "/index" || path === "")) return "/";
	return path || "/";
}

export function markdownSiblingPath(pathname: string): string {
	const key = normalizePagePath(pathname);
	return key === "/" ? "/index.md" : `${key}.md`;
}
