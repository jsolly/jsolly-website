// The B04 content rewrites over src/content/blog/posts/*.md, deterministic and
// idempotent (C0 runs them again after the re-sync):
//
//   node scripts/port/rewrite-content.mjs --dry-run   # list what would change
//   node scripts/port/rewrite-content.mjs
//
// - Absolute links to the old host (apex or www, http or https, in an href or
//   a Markdown link target) become root-relative jsolly paths, keeping the query
//   and #fragment. The destination is the url-map.json redirect row for that
//   path, so renamed posts and the recipe post land where the legacy host
//   sends them. robots.txt and security.txt keep their path; jsolly serves both.
// - The /password-reset/ anchors become their plain link text.
// - The dropped recipe post (J7) leaves every post's `related` list.
// - Headings with no text (`## <img …>`, `<h2>&nbsp;</h2>`) stop being
//   headings: they rendered an empty id, and process-html once gave them "#".
//
// Nothing inside fenced code blocks, `inline code`, <code> or <pre> changes,
// and only the posts' *.md files are read: the receipts and url-map.json are
// never written. An old-host link with no known destination fails the run
// before anything is written.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	DROPPED_RECIPE_POST,
	groupsOf,
	parseCli,
	redirectPaths,
	runCli,
} from "./lib.mjs";

const POSTS_DIR = "src/content/blog/posts";
const OLD_POST = /^\/post\/(?<slug>[^/]+)\/?$/u;
const MARKDOWN_EXTENSION = /\.md$/u;
const SAME_PATH = new Set(["/robots.txt", "/.well-known/security.txt"]);
const POST_FILE = /^[^.].*\.md$/u;
const FRONTMATTER = /^(?<block>---\n[\s\S]*?\n---(?:\n|$))/u;
const OLD_HOST_URL = /https?:\/\/(?:www\.)?blogthedata\.com(?:[/?#][^"'\s)]*)?/u
	.source;
const PASSWORD_RESET_ANCHOR =
	/<a\b[^>]*\bhref=(?<quote>["'])https?:\/\/(?:www\.)?blogthedata\.com\/password-reset\/?\k<quote>[^>]*>(?<text>[\s\S]*?)<\/a>/giu;
const HREF = new RegExp(
	`(?<before>\\bhref=(?<quote>["']))(?<url>${OLD_HOST_URL})(?=\\k<quote>)`,
	"giu",
);
const MARKDOWN_TARGET = new RegExp(
	`(?<before>\\]\\()(?<url>${OLD_HOST_URL})(?=[)\\s])`,
	"giu",
);
const LAST_SEGMENT_HAS_DOT = /\.[^/]*$/u;
const FENCE_OPEN = /^ {0,3}(?<fence>`{3,}|~{3,})/u;
const HTML_CODE = /<(?<tag>pre|code)\b[^>]*>[\s\S]*?<\/\k<tag>\s*>/giu;
const BACKTICKS = /`+/gu;
const LINE = /[^\n]*\n|[^\n]+$/gu;
// Whole-line headings; `tail` is the line end plus, for an HTML heading, the
// blank line after it, so removing an empty one leaves a single blank line.
const ATX_HEADING_LINE = /^#{1,6}[ \t]+(?<content>.*?)[ \t]*(?<tail>\n|$)/gmu;
const HTML_HEADING_LINE =
	/^[ \t]*<h(?<level>[1-6])\b[^>]*>(?<content>[\s\S]*?)<\/h\k<level>>[ \t]*(?<tail>\n(?:[ \t]*\n)?|$)/gimu;
const TAG = /<[^>]*>/gu;
const IMG_TAG = /<img\b/iu;
const BLANK = /&nbsp;|&#160;|&#xa0;|\s/giu;
const RELATED_KEY = /^related:[ \t]*(?<inline>\S.*)?$/u;
const LIST_ITEM = /^[ \t]+-[ \t]+(?<value>.*?)[ \t]*$/u;
const INDENTED = /^[ \t]/u;
const QUOTES = /^(?<quote>["'])(?<inner>.*)\k<quote>$/u;

// [start, end) ranges of code in a Markdown body: fenced blocks, <pre> and
// <code> elements, then inline code spans outside both.
function codeRanges(body) {
	const ranges = [];
	let fence = null;
	let fenceStart = 0;
	for (const match of body.matchAll(LINE)) {
		const opener = groupsOf(FENCE_OPEN, match[0])?.fence;
		if (fence === null && opener) {
			fence = opener;
			fenceStart = match.index;
		} else if (
			fence !== null &&
			opener?.[0] === fence[0] &&
			opener.length >= fence.length
		) {
			ranges.push([fenceStart, match.index + match[0].length]);
			fence = null;
		}
	}
	if (fence !== null) {
		ranges.push([fenceStart, body.length]);
	}
	const inRange = (index) =>
		ranges.some(([start, end]) => index >= start && index < end);
	for (const match of body.matchAll(HTML_CODE)) {
		if (!inRange(match.index)) {
			ranges.push([match.index, match.index + match[0].length]);
		}
	}
	const runs = [...body.matchAll(BACKTICKS)].filter(
		(run) => !(inRange(run.index) || body[run.index - 1] === "\\"),
	);
	for (let open = 0; open < runs.length; open += 1) {
		const close = runs.findIndex(
			(run, index) => index > open && run[0].length === runs[open][0].length,
		);
		if (close !== -1) {
			ranges.push([
				runs[open].index,
				runs[close].index + runs[close][0].length,
			]);
			open = close;
		}
	}
	// Sorted and merged, so overlapping spans count once.
	const merged = [];
	for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
		const last = merged.at(-1);
		if (last && start <= last[1]) {
			last[1] = Math.max(last[1], end);
		} else {
			merged.push([start, end]);
		}
	}
	return merged;
}

// Applies `rewrite` to the text between code ranges; code is copied verbatim.
function outsideCode(body, rewrite) {
	let output = "";
	let cursor = 0;
	for (const [start, end] of codeRanges(body)) {
		output += rewrite(body.slice(cursor, start)) + body.slice(start, end);
		cursor = end;
	}
	return output + rewrite(body.slice(cursor));
}

function isEmptyHeading(content) {
	return content.replace(TAG, "").replace(BLANK, "") === "";
}

// The root-relative jsolly URL for an old-host URL, or null when unknown. A
// post published after the cut has no url-map row until C0's url-map-sync,
// which runs after this; its DST file is proof enough of /blog/<slug>/.
function jsollyUrl(url, { redirects, posts }) {
	const parsed = new URL(url);
	const suffix = `${parsed.search}${parsed.hash}`;
	if (SAME_PATH.has(parsed.pathname)) {
		return `${parsed.pathname}${suffix}`;
	}
	const candidates = [parsed.pathname];
	if (
		!(
			parsed.pathname.endsWith("/") ||
			LAST_SEGMENT_HAS_DOT.test(parsed.pathname)
		)
	) {
		candidates.push(`${parsed.pathname}/`);
	}
	const destination = candidates
		.map((path) => redirects.get(path))
		.find(Boolean);
	if (destination) {
		return `${destination}${suffix}`;
	}
	const slug = groupsOf(OLD_POST, parsed.pathname)?.slug;
	return posts.has(slug) ? `/blog/${slug}/${suffix}` : null;
}

// Drops DROPPED_RECIPE_POST from a block-style `related:` list.
function rewriteRelated(frontmatter, problems) {
	const lines = frontmatter.split("\n");
	const key = lines.findIndex((line) => RELATED_KEY.test(line));
	if (key === -1) {
		return { text: frontmatter, removed: 0 };
	}
	if (
		RELATED_KEY.exec(lines[key]).groups.inline?.includes(DROPPED_RECIPE_POST)
	) {
		problems.push(`inline related list names ${DROPPED_RECIPE_POST}`);
		return { text: frontmatter, removed: 0 };
	}
	let end = key + 1;
	while (end < lines.length && INDENTED.test(lines[end])) {
		end += 1;
	}
	const items = lines.slice(key + 1, end);
	const kept = items.filter((line) => {
		const value = groupsOf(LIST_ITEM, line)?.value;
		return (
			(groupsOf(QUOTES, value ?? "")?.inner ?? value) !== DROPPED_RECIPE_POST
		);
	});
	const removed = items.length - kept.length;
	if (removed === 0) {
		return { text: frontmatter, removed };
	}
	const block = kept.length === 0 ? ["related: []"] : [lines[key], ...kept];
	return {
		text: [...lines.slice(0, key), ...block, ...lines.slice(end)].join("\n"),
		removed,
	};
}

// One post's rewritten text, the count of each rewrite and any unresolved link.
function rewritePost(text, known) {
	const counts = { links: 0, passwordReset: 0, related: 0, headings: 0 };
	const problems = [];
	const targets = new Set();
	const frontmatter = groupsOf(FRONTMATTER, text)?.block ?? "";
	const related = rewriteRelated(frontmatter, problems);
	counts.related = related.removed;
	const replaceUrl = (match, before, url) => {
		const rewritten = jsollyUrl(url, known);
		if (rewritten === null) {
			problems.push(`no jsolly destination for ${url}`);
			return match;
		}
		counts.links += 1;
		targets.add(rewritten);
		return `${before}${rewritten}`;
	};
	// An empty heading keeps only its image, on a line of its own, or goes.
	const unheading = (match, ...args) => {
		const { content, tail } = args.at(-1);
		if (!isEmptyHeading(content)) {
			return match;
		}
		counts.headings += 1;
		return IMG_TAG.test(content) ? `${content.trim()}${tail}` : "";
	};
	const body = outsideCode(text.slice(frontmatter.length), (prose) =>
		prose
			.replace(PASSWORD_RESET_ANCHOR, (...args) => {
				counts.passwordReset += 1;
				return args.at(-1).text;
			})
			.replace(HREF, (match, ...args) =>
				replaceUrl(match, args.at(-1).before, args.at(-1).url),
			)
			.replace(MARKDOWN_TARGET, (match, ...args) =>
				replaceUrl(match, args.at(-1).before, args.at(-1).url),
			)
			.replace(ATX_HEADING_LINE, unheading)
			.replace(HTML_HEADING_LINE, unheading),
	);
	return { text: `${related.text}${body}`, counts, problems, targets };
}

function main(argv) {
	const { dst, "dry-run": dryRun } = parseCli(argv, {
		locations: ["dst"],
		options: { "dry-run": { type: "boolean" } },
	});
	const dir = join(dst, POSTS_DIR);
	const names = readdirSync(dir)
		.filter((name) => POST_FILE.test(name))
		.sort();
	const known = {
		redirects: redirectPaths(dst),
		posts: new Set(names.map((name) => name.replace(MARKDOWN_EXTENSION, ""))),
	};
	const results = names.map((name) => {
		const before = readFileSync(join(dir, name), "utf8");
		return { name, before, ...rewritePost(before, known) };
	});
	const problems = results.flatMap(({ name, problems: found }) =>
		found.map((problem) => `${POSTS_DIR}/${name}: ${problem}`),
	);
	if (problems.length > 0) {
		throw new Error(
			`unresolved rewrites, nothing written:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
		);
	}
	const changed = results.filter(({ before, text }) => before !== text);
	const totals = { links: 0, passwordReset: 0, related: 0, headings: 0 };
	const targets = new Set();
	for (const result of changed) {
		for (const key of Object.keys(totals)) {
			totals[key] += result.counts[key];
		}
		for (const target of result.targets) {
			targets.add(target);
		}
		if (!dryRun) {
			writeFileSync(join(dir, result.name), result.text);
		}
	}
	console.log(
		`${dryRun ? "Would change" : "✓ Changed"} ${changed.length} of ${results.length} posts: ${totals.links} old-host links to ${targets.size} targets, ${totals.passwordReset} password-reset anchors, ${totals.related} related entries, ${totals.headings} empty headings.`,
	);
	for (const { name, counts } of changed) {
		const kinds = Object.entries(counts)
			.filter(([, count]) => count > 0)
			.map(([kind, count]) => `${kind} ${count}`)
			.join(", ");
		console.log(`  ${POSTS_DIR}/${name} (${kinds})`);
	}
	return 0;
}

runCli(import.meta.url, main);
