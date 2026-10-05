// The blog's page URLs; slugs keep their case (e.g. /blog/category/Geodev/).
// Dependency-free, so client islands such as BlogNavigation import it without
// pulling in the article sanitizer that cards.ts and html.ts carry.

export function postHref(slug: string) {
	return `/blog/${slug}/`;
}

export function categoryHref(category: string) {
	return `/blog/category/${category}/`;
}
