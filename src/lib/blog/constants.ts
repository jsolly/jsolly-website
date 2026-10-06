// Where the post files live, relative to the project root, and the glob that
// picks them out; the collection loader and the sitemap's postLastmods read
// the same files.
export const POSTS_DIR = "src/content/blog/posts";
export const POST_FILES = "*.md";

// Where the category files live, relative to the project root; the categories
// collection and .pages.yml both point here.
export const CATEGORIES_DIR = "src/content/blog/categories";

// The post image when frontmatter names none; the posts schema defaults to it.
export const DEFAULT_IMAGE = "/blog/media/default.webp";

// The retained blogthedata S3/CloudFront media base for legacy post images (J6).
export const LEGACY_MEDIA = "https://d1d7p8ufhgz4ld.cloudfront.net/media/";

// The hosts post bodies may embed in an iframe: the sanitizer keeps only these
// iframes, and BlogLayout allows exactly these in frame-src.
export const EMBED_HOSTS = [
	"www.youtube.com",
	"www.youtube-nocookie.com",
	"viewer.diagrams.net",
	"nbviewer.org",
];

// The reading speed post cards estimate "min read" from.
export const WORDS_PER_MINUTE = 238;

// Post cards a paged list (the blog home, a category) shows per batch.
export const POSTS_PER_BATCH = 3;

// Batches a paged list loads on scroll before Load more takes over; pressing
// it grants this many again.
export const AUTOMATIC_BATCHES = 3;

// The old blog host. Posts that predate the merge keep their feed ids on it,
// and the Atom feed keeps its id (J8).
export const LEGACY_SITE = "https://www.blogthedata.com";

// Posts the feeds list, most recently updated first.
export const FEED_SIZE = 5;

// Both feeds' title and description, kept from the old blog (J25 parity).
export const FEED_TITLE = "blogthedata | Blog";
export const FEED_DESCRIPTION = "Latest blog posts from blogthedata";

// The Atom feed's id on the old host, unchanged so readers keep the feed (J8).
export const ATOM_FEED_ID = `${LEGACY_SITE}/atom/`;

// The blog's two feeds: where each is served, its media type (vercel.json
// sends it as `<type>; charset=utf-8`) and the title BlogLayout's alternate
// link gives it.
export const FEEDS = {
	rss: {
		path: "/blog/rss.xml",
		type: "application/rss+xml",
		title: "Blogthedata RSS",
	},
	atom: {
		path: "/blog/atom.xml",
		type: "application/atom+xml",
		title: "Blogthedata Atom",
	},
} as const;
