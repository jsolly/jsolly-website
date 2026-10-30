import type { z } from "zod";
import { imageUrl } from "./images.js";
import type { postSchema } from "./schemas.js";
import { postHref } from "./urls.js";

export interface Breadcrumb {
	name: string;
	href: string;
}

// Use the same ordered crumbs for the visible navigation and its JSON-LD.
export function breadcrumbList(crumbs: readonly Breadcrumb[], site: URL) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: crumbs.map((crumb, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: crumb.name,
			item: new URL(crumb.href, site).href,
		})),
	};
}

// Escape authored text before embedding it in an HTML script element.
export function jsonLd(value: unknown) {
	return JSON.stringify(value).replace(/</gu, "\\u003c");
}

export function blogPosting(
	data: z.infer<typeof postSchema>,
	categoryName: string,
	site: URL,
) {
	const url = new URL(postHref(data.slug), site).href;
	return {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		"@id": `${url}#article`,
		headline: data.title,
		description: data.description,
		image: {
			"@type": "ImageObject",
			url: new URL(imageUrl(data.image), site).href,
			...(data.imageWidth === null ? {} : { width: data.imageWidth }),
			...(data.imageHeight === null ? {} : { height: data.imageHeight }),
		},
		datePublished: data.published.toISOString(),
		dateModified: data.updated.toISOString(),
		author:
			data.author === "John Solly"
				? { "@id": `${site.origin}/#person` }
				: { "@type": "Person", name: data.author },
		publisher: { "@id": `${site.origin}/#organization` },
		isPartOf: { "@id": `${site.origin}/#website` },
		mainEntityOfPage: { "@type": "WebPage", "@id": url },
		inLanguage: "en-US",
		articleSection: categoryName,
	};
}
