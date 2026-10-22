import type { AstroUserConfig } from "astro";

type AstroCsp = Exclude<
	NonNullable<NonNullable<AstroUserConfig["security"]>["csp"]>,
	boolean
>;

// The Vercel Toolbar (Preview comments) loads from these hosts.
// https://vercel.com/docs/vercel-toolbar/managing-toolbar
export const VERCEL_TOOLBAR_SOURCES = {
	"script-src": ["https://vercel.live"],
	"connect-src": ["https://vercel.live", "wss://ws-us3.pusher.com"],
	"frame-src": ["https://vercel.live"],
	"img-src": ["https://vercel.live", "https://vercel.com", "data:", "blob:"],
	"font-src": ["https://vercel.live", "https://assets.vercel.com"],
	"style-src": ["https://vercel.live", "'unsafe-inline'"],
} as const;

type ToolbarDirective = keyof typeof VERCEL_TOOLBAR_SOURCES;

const TOOLBAR_BY_DIRECTIVE: ReadonlyMap<string, readonly string[]> = new Map(
	Object.entries(VERCEL_TOOLBAR_SOURCES),
);
const WHITESPACE = /\s+/u;

function withToolbar(directive: ToolbarDirective): string[] {
	return [...new Set(["'self'", ...VERCEL_TOOLBAR_SOURCES[directive]])];
}

/**
 * The Astro meta policy. Production builds allow only same-origin resources
 * plus Astro's script hashes. Vercel Preview builds (VERCEL_ENV=preview) also
 * allow the Vercel Toolbar so reviewers can comment on the deployment.
 * Browsers enforce the intersection with the header, so middleware.ts widens
 * the header the same way on Preview deployments (previewHeaderPolicy).
 */
export function astroCsp(vercelEnv: string | undefined): AstroCsp {
	if (vercelEnv !== "preview") {
		return {
			directives: ["default-src 'self'"],
			styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
		};
	}
	return {
		directives: [
			"default-src 'self'",
			...(["connect-src", "frame-src", "img-src", "font-src"] as const).map(
				(directive) =>
					`${directive} ${withToolbar(directive).join(" ")}` as const,
			),
		],
		scriptDirective: { resources: withToolbar("script-src") },
		styleDirective: { resources: withToolbar("style-src") },
	};
}

type HeaderRule = {
	source: string;
	headers: { key: string; value: string }[];
};

/** The one Content-Security-Policy vercel.json sends on every route. */
export function siteHeaderPolicy(config: { headers: HeaderRule[] }): string {
	const policies = config.headers.flatMap(({ source, headers }) =>
		headers
			.filter(({ key }) => key.toLowerCase() === "content-security-policy")
			.map(({ value }) => ({ source, value })),
	);
	const [policy] = policies;
	if (policies.length !== 1 || policy?.source !== "/(.*)") {
		throw new Error(
			'vercel.json must send exactly one Content-Security-Policy, on "/(.*)"',
		);
	}
	return policy.value;
}

/**
 * The header policy with the Vercel Toolbar hosts added to each directive it
 * already restricts. Directives the header leaves to the Astro meta stay absent.
 */
function previewHeaderPolicy(policy: string): string {
	return policy
		.split(";")
		.map((entry) => entry.trim().split(WHITESPACE))
		.filter(([name]) => name)
		.map(([name = "", ...sources]) => {
			const toolbar = TOOLBAR_BY_DIRECTIVE.get(name) ?? [];
			return [name, ...new Set([...sources, ...toolbar])].join(" ");
		})
		.join("; ");
}

/**
 * Response headers middleware.ts adds: the widened policy on Vercel Preview
 * deployments, nothing anywhere else.
 */
export function previewResponseHeaders(
	vercelEnv: string | undefined,
	config: { headers: HeaderRule[] },
): Record<string, string> {
	return vercelEnv === "preview"
		? {
				"Content-Security-Policy": previewHeaderPolicy(
					siteHeaderPolicy(config),
				),
			}
		: {};
}
