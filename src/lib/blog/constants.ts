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
