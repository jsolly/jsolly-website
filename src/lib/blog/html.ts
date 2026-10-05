import { decodeHTML } from "entities";
import sanitizeHtml from "sanitize-html";

// The retained blogthedata S3/CloudFront host for legacy post images (J6).
const legacyMedia = "https://d1d7p8ufhgz4ld.cloudfront.net/media/";
const DEFAULT_IMAGE = "/blog/media/default.webp";

const ABSOLUTE_HTTPS = /^https:\/\//u;
const MEDIAFILES_PREFIX = /^\/?mediafiles\//u;
const WHITESPACE_RUN = /\s+/gu;
const NON_SLUG_CHARACTER = /[^a-zA-Z0-9_-]/gu;
// An h1–h3 element with its attributes and inner HTML.
const HEADING = /<(?<tag>h[1-3])(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/\k<tag>>/gu;
const HEADING_TAG = /^h[1-3]$/u;
const OPENING_TAG = /<(?<tag>[a-z][a-z0-9]*)(?<attributes>[^>]*)>/gu;
const ID_ATTRIBUTE = /\s+id="[^"]*"/gu;
const CAPTURED_ID_ATTRIBUTE = /\s+id="(?<id>[^"]*)"/gu;

// CSS values authored posts carry in inline style attributes.
const LENGTH = /^\d+(?:\.\d+)?(?:%|px|em|rem)$/u;
const ZERO_OR_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:%|px|em|rem))$/u;
const ZERO_OR_FIXED_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|em|rem))$/u;
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)\([\d.,%\s]+\))$/iu;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/iu;
const ASPECT_RATIO = /^\d+\s*\/\s*\d+$/u;
const TEXT_ALIGN = /^(?:left|right|center|justify|start)$/u;
const FLOAT = /^(?:left|right|none)$/u;
const POSITION = /^(?:relative|absolute)$/u;
const ZERO = /^0$/u;
const PADDING = /^(?:\d+(?:\.\d+)?(?:px|em|rem)\s*){1,4}$/u;
const BORDER = /^\d+px solid (?:black|#[0-9a-f]{3,8})$/iu;
const SOLID = /^solid$/u;
const COLLAPSE = /^collapse$/u;
const AUTO = /^auto$/u;
const FONT_FAMILY = /^[a-z\s,-]+$/iu;
const FONT_SIZE = /^\d+(?:\.\d+)?(?:px|em|rem)$/u;
const FONT_WEIGHT = /^[1-9]00$/u;
const LINE_HEIGHT = /^\d+(?:\.\d+)?$/u;
const DISC = /^disc$/u;
const INLINE = /^inline(?:\s*!important)?$/u;
const NORMAL = /^normal$/u;
const NONE = /^none$/u;
const ZERO_PX = /^0px$/u;
const INITIAL = /^initial$/u;
const TWO = /^2$/u;

function imageUrl(path: string) {
	if (!path || path === "default.webp") return DEFAULT_IMAGE;
	if (ABSOLUTE_HTTPS.test(path) || path.startsWith("/blog/media/")) return path;
	return `${legacyMedia}${path.replace(MEDIAFILES_PREFIX, "")}`;
}

export function plainText(html: string) {
	return decodeHTML(
		sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }),
	)
		.replace(WHITESPACE_RUN, " ")
		.trim();
}

const ARTICLE_SANITIZE: sanitizeHtml.IOptions = {
	allowedTags: [
		...sanitizeHtml.defaults.allowedTags,
		"img",
		"iframe",
		"del",
		"video",
		"source",
	],
	allowedAttributes: {
		"*": ["id", "class", "style"],
		a: ["href", "title", "target", "rel"],
		img: ["src", "alt", "width", "height", "loading", "decoding"],
		iframe: [
			"src",
			"title",
			"width",
			"height",
			"allow",
			"allowfullscreen",
			"loading",
		],
		td: ["colspan", "rowspan"],
		th: ["colspan", "rowspan", "scope"],
		code: ["class"],
		ol: ["start"],
		video: ["src", "controls", "poster"],
		source: ["src", "type"],
	},
	allowedSchemes: ["https", "http", "mailto"],
	allowedIframeHostnames: [
		"www.youtube.com",
		"www.youtube-nocookie.com",
		"viewer.diagrams.net",
		"nbviewer.org",
	],
	allowedStyles: {
		"*": {
			width: [ZERO_OR_LENGTH],
			height: [ZERO_OR_LENGTH],
			"min-width": [LENGTH],
			"aspect-ratio": [ASPECT_RATIO],
			"text-align": [TEXT_ALIGN],
			float: [FLOAT],
			"background-color": [COLOR],
			color: [COLOR],
			position: [POSITION],
			top: [ZERO],
			left: [ZERO],
			"padding-bottom": [LENGTH],
			padding: [PADDING],
			"margin-left": [ZERO_OR_FIXED_LENGTH],
			border: [BORDER],
			"border-color": [HEX_COLOR],
			"border-style": [SOLID],
			"border-collapse": [COLLAPSE],
			"overflow-x": [AUTO],
			"font-family": [FONT_FAMILY],
			"font-size": [FONT_SIZE],
			"font-weight": [FONT_WEIGHT],
			"line-height": [LINE_HEIGHT],
			"list-style-type": [DISC],
			display: [INLINE],
			"font-style": [NORMAL],
			"font-variant-caps": [NORMAL],
			"font-variant-ligatures": [NORMAL],
			"letter-spacing": [NORMAL],
			"white-space": [NORMAL],
			"text-transform": [NONE],
			"text-indent": [ZERO_PX],
			"word-spacing": [ZERO_PX],
			"text-decoration-color": [INITIAL],
			"text-decoration-style": [INITIAL],
			"text-decoration-thickness": [INITIAL],
			"-webkit-text-stroke-width": [ZERO_PX],
			orphans: [TWO],
			widows: [TWO],
		},
	},
	transformTags: {
		img: (_tag, attrs) => {
			const { src = "" } = attrs;
			return {
				tagName: "img",
				attribs: {
					...attrs,
					src: imageUrl(src),
					loading: "lazy",
					decoding: "async",
				},
			};
		},
		iframe: (_tag, attrs) => {
			const { title } = attrs;
			return {
				tagName: "iframe",
				attribs: {
					...attrs,
					title: title || "Embedded article content",
					loading: "lazy",
				},
			};
		},
		a: (_tag, attrs) => ({
			tagName: "a",
			attribs: { ...attrs, rel: "noopener noreferrer" },
		}),
	},
};

export function articleHtml(body: string) {
	const headingIds = new Set<string>();
	const rendered = sanitizeHtml(body, ARTICLE_SANITIZE).replace(
		HEADING,
		(_match: string, tag: string, attrs: string, text: string) => {
			const id = headingId(plainText(text));
			headingIds.add(id);
			const attributes = attrs.replace(ID_ATTRIBUTE, "");
			return `<${tag}${attributes} id="${id}">${text}<a class="heading-link" href="#${id}" aria-label="Link to this heading">#</a></${tag}>`;
		},
	);
	return rendered.replace(
		OPENING_TAG,
		(match: string, tag: string, attributes: string) => {
			if (HEADING_TAG.test(tag)) return match;
			return `<${tag}${attributes.replace(
				CAPTURED_ID_ATTRIBUTE,
				(attribute: string, id: string) =>
					headingIds.has(id) ? "" : attribute,
			)}>`;
		},
	);
}

export function headingId(text: string) {
	return text
		.trim()
		.toLowerCase()
		.replace(WHITESPACE_RUN, "-")
		.replace(NON_SLUG_CHARACTER, "");
}
