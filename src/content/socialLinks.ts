import type { ImageMetadata } from "astro";
import blogthedataLogo from "../images/social/blogthedataLogo.svg";
import githubLogo from "../images/social/githubLogo.svg";
import linkedinLogo from "../images/social/linkedinLogo.svg";
import xLogo from "../images/social/xLogo.svg";
import youtubeLogo from "../images/social/youtubeLogo.svg";

interface SocialLink {
	href: string;
	icon: ImageMetadata;
	alt: string;
	ariaLabel: string;
	rel: string;
}

export const socialLinks: readonly SocialLink[] = [
	{
		href: "https://github.com/jsolly",
		icon: githubLogo,
		alt: "GitHub",
		ariaLabel: "Visit John Solly's GitHub profile (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		href: "https://www.linkedin.com/in/jsolly/",
		icon: linkedinLogo,
		alt: "LinkedIn",
		ariaLabel: "Visit John Solly's LinkedIn profile (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		href: "https://x.com/_jsolly",
		icon: xLogo,
		alt: "X",
		ariaLabel: "Visit John Solly's X (Twitter) profile (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		href: "https://www.youtube.com/channel/UCxsK9UorVj2F17DMSXLuSQw",
		icon: youtubeLogo,
		alt: "YouTube",
		ariaLabel: "Visit John Solly's YouTube channel (opens in new tab)",
		rel: "me noopener noreferrer",
	},
	{
		href: "https://blogthedata.com/",
		icon: blogthedataLogo,
		alt: "Blogthedata Blog",
		ariaLabel: "Visit John Solly's Blogthedata blog (opens in new tab)",
		rel: "me",
	},
];
