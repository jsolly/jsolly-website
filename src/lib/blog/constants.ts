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
