// A primary portfolio link. Only a new-tab link carries target and rel.
export interface SiteLink {
	href: string;
	text: string;
	label: string;
	target?: "_blank";
	rel?: "noopener noreferrer";
}

// The social profiles that have an icon; SocialLinks.astro maps each to its SVG.
export type SocialIcon = "github" | "linkedin" | "x" | "youtube";

export interface SocialLink {
	href: string;
	icon: SocialIcon;
	alt: string;
	ariaLabel: string;
	rel: string;
}
