// The portfolio's primary links, rendered by SiteNavigation (desktop and
// mobile) and the footer. Only a link marked newTab opens a new tab.
interface SiteLink {
	href: string;
	text: string;
	label: string;
	newTab?: boolean;
}

export const siteLinks: readonly SiteLink[] = [
	{ href: "/about/", text: "About", label: "About John Solly" },
	{ href: "/contact/", text: "Contact", label: "Contact John Solly" },
	{ href: "/blog/", text: "Blog", label: "Read John Solly's blog" },
	{ href: "/recipes/", text: "Recipes", label: "Browse John Solly's recipes" },
	{
		href: "/John-Solly-Resume.pdf",
		text: "Resume",
		label: "Download John Solly's resume (opens in new tab)",
		newTab: true,
	},
];

// The target and rel a link renders with: a new-tab link gets both, any other
// link neither.
export function newTabAttributes(link: SiteLink): {
	target?: "_blank";
	rel?: "noopener noreferrer";
} {
	return link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
}
