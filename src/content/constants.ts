import type { SiteLink, SocialLink } from "./types.js";

// John's role and the site's self-description, in the J18 wording of the
// blogthedata merge plan, shared by every page, the JSON-LD and the agent
// Markdown. public/llms.txt cannot import them; constants.test.ts holds it to
// them. This module imports no assets, so the middleware and the navigation
// island can import it.
const UNIT = "Enterprise Health";
export const EMPLOYER = "Leidos Digital";
// The title in prose, split so the home hero can accent the employer:
// "John Solly, CTO of Enterprise Health at Leidos Digital".
export const ROLE_PREFIX = `CTO of ${UNIT} at`;
export const ROLE = `${ROLE_PREFIX} ${EMPLOYER}`;
// The formal title (JSON-LD jobTitle).
export const JOB_TITLE = `CTO, ${UNIT}, ${EMPLOYER}`;
// The short label under his name.
export const SHORT_ROLE = "CTO & Software Engineer";
export const ROLE_STRATEGY = `lead technology strategy for ${UNIT} at ${EMPLOYER}`;

export const BLOG_DESCRIPTION =
	"articles about geospatial development, web development, AI and productivity";
export const RECIPES_DESCRIPTION =
	"easy meals and smoothies, with serving scaling and appliance filters";

// The portfolio's primary links, rendered by SiteNavigation (desktop and
// mobile) and the footer.
export const siteLinks: readonly SiteLink[] = [
	{ href: "/about/", text: "About", label: "About John Solly" },
	{ href: "/contact/", text: "Contact", label: "Contact John Solly" },
	{ href: "/blog/", text: "Blog", label: "Blog by John Solly" },
	{ href: "/recipes/", text: "My Recipes", label: "My Recipes" },
	{
		href: "/John-Solly-Resume.pdf",
		text: "Resume",
		label: "Download John Solly's resume (opens in new tab)",
		target: "_blank",
		rel: "noopener noreferrer",
	},
];

export const socialLinks: readonly SocialLink[] = [
	{
		href: "https://github.com/jsolly",
		icon: "github",
		alt: "GitHub",
		ariaLabel: "Visit John Solly's GitHub profile (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		href: "https://www.linkedin.com/in/jsolly/",
		icon: "linkedin",
		alt: "LinkedIn",
		ariaLabel: "Visit John Solly's LinkedIn profile (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		href: "https://x.com/_jsolly",
		icon: "x",
		alt: "X",
		ariaLabel: "Visit John Solly's X (Twitter) profile (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		// biome-ignore lint/security/noSecrets: public YouTube channel URL, not a credential
		href: "https://www.youtube.com/channel/UCxsK9UorVj2F17DMSXLuSQw",
		icon: "youtube",
		alt: "YouTube",
		ariaLabel: "Visit John Solly's YouTube channel (opens in new tab)",
		rel: "me noopener noreferrer",
	},
];
