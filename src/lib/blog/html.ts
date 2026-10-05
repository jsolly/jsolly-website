import { decodeHTML } from "entities";
import sanitizeHtml from "sanitize-html";
import { DEFAULT_IMAGE, EMBED_HOSTS, LEGACY_MEDIA } from "./constants.js";

const ABSOLUTE_HTTP = /^https?:\/\//iu;
const MEDIAFILES_PREFIX = /^mediafiles\//u;
const WHITESPACE_RUN = /\s+/gu;
const NON_SLUG_CHARACTER = /[^a-zA-Z0-9_-]/gu;
// An h1–h3 element with its attributes and inner HTML.
const HEADING = /<(?<tag>h[1-3])(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/\k<tag>>/gu;
const HEADING_TAG = /^h[1-3]$/u;
const OPENING_TAG = /<(?<tag>[a-z][a-z0-9]*)(?<attributes>[^>]*)>/gu;
// An <a> opening tag whose href is a same-page fragment.
const FRAGMENT_LINK = /(?<before><a\b[^>]*?\shref=")#(?<fragment>[^"]*)"/gu;
const CAPTURED_ID_ATTRIBUTE = /\s+id="(?<id>[^"]*)"/gu;
// An id attribute inside a tag, not id="…" text inside escaped code samples.
const TAG_ID = /<[a-z][a-z0-9]*\b[^>]*?\sid="(?<id>[^"]*)"/gu;

// CSS values the style table below accepts for more than one property.
const LENGTH = /^\d+(?:\.\d+)?(?:%|px|em|rem)$/u;
const ZERO_OR_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:%|px|em|rem))$/u;
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)\([\d.,%\s]+\))$/iu;
const ZERO = /^0$/u;
const NORMAL = /^normal$/u;
const ZERO_PX = /^0px$/u;
const INITIAL = /^initial$/u;
const TWO = /^2$/u;

// A bare legacy-relative path (a Django upload such as `post_imgs/x.webp` or
// `mediafiles/x.webp`) lives on the legacy CloudFront host. Absolute http(s),
// protocol-relative and root-relative sources, including /blog/media/ CMS
// uploads, stay as authored.
export function imageUrl(path: string) {
	if (!path || path === "default.webp") return DEFAULT_IMAGE;
	if (ABSOLUTE_HTTP.test(path) || path.startsWith("/")) return path;
	return `${LEGACY_MEDIA}${path.replace(MEDIAFILES_PREFIX, "")}`;
}

// Decoded, unescaped text: safe in Astro/Svelte `{}` expressions and for
// slugging, never in set:html or an inline <script>/JSON blob unless `<` is
// escaped first.
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
	allowedIframeHostnames: EMBED_HOSTS,
	allowedStyles: {
		"*": {
			width: [ZERO_OR_LENGTH],
			height: [ZERO_OR_LENGTH],
			"min-width": [LENGTH],
			"aspect-ratio": [/^\d+\s*\/\s*\d+$/u],
			"text-align": [/^(?:left|right|center|justify|start)$/u],
			float: [/^(?:left|right|none)$/u],
			"background-color": [COLOR],
			color: [COLOR],
			position: [/^(?:relative|absolute)$/u],
			top: [ZERO],
			left: [ZERO],
			"padding-bottom": [LENGTH],
			padding: [/^(?:\d+(?:\.\d+)?(?:px|em|rem)\s*){1,4}$/u],
			"margin-left": [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem))$/u],
			border: [/^\d+px solid (?:black|#[0-9a-f]{3,8})$/iu],
			"border-color": [/^#[0-9a-f]{3,8}$/iu],
			"border-style": [/^solid$/u],
			"border-collapse": [/^collapse$/u],
			"overflow-x": [/^auto$/u],
			"font-family": [/^[a-z\s,-]+$/iu],
			"font-size": [/^\d+(?:\.\d+)?(?:px|em|rem)$/u],
			"font-weight": [/^[1-9]00$/u],
			"line-height": [/^\d+(?:\.\d+)?$/u],
			"list-style-type": [/^disc$/u],
			display: [/^inline(?:\s*!important)?$/u],
			"font-style": [NORMAL],
			"font-variant-caps": [NORMAL],
			"font-variant-ligatures": [NORMAL],
			"letter-spacing": [NORMAL],
			"white-space": [NORMAL],
			"text-transform": [/^none$/u],
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
	// Authored h1–h3 ids the heading pass replaced, mapped to their new ids.
	const renamedIds = new Map<string, string>();
	const rendered = sanitizeHtml(body, ARTICLE_SANITIZE).replace(
		HEADING,
		(_match: string, tag: string, attrs: string, text: string) => {
			const id = headingId(plainText(text));
			headingIds.add(id);
			const attributes = attrs.replace(
				CAPTURED_ID_ATTRIBUTE,
				(_attribute: string, authored: string) => {
					if (authored !== id && !renamedIds.has(authored)) {
						renamedIds.set(authored, id);
					}
					return "";
				},
			);
			return `<${tag}${attributes} id="${id}">${text}<a class="heading-link" href="#${id}" aria-label="Link to this heading">#</a></${tag}>`;
		},
	);
	const html = rendered.replace(
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
	if (renamedIds.size === 0) return html;
	// Same-page links (a table of contents) that named a replaced heading id
	// follow it to the new id; a fragment that still resolves is left alone.
	const ids = new Set(Array.from(html.matchAll(TAG_ID), (match) => match[1]));
	return html.replace(
		FRAGMENT_LINK,
		(match: string, before: string, fragment: string) => {
			const renamed = renamedIds.get(fragment);
			return renamed === undefined || ids.has(fragment)
				? match
				: `${before}#${renamed}"`;
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
