#!/usr/bin/env node
// Mechanical inventory coverage: every tracked awesome-blog file at the source SHA gets
// exactly one resolved disposition from inventory-{app,recipes,ops}.json.
// Fixes the earlier checker: expands {a,b} braces and `ext|ext` alternation, and resolves
// double listings with explicit rules instead of reporting them as errors.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.dirname(OUT);
const SRC = process.env.SRC_REPO ?? "/Users/johnsolly/code/awesome-blog";
// Pinned to the plan's source SHA (not origin/main), so the run reproduces after B00's
// freeze PR moves awesome-blog main. Override with --src-ref <ref>.
const refArg = process.argv.indexOf("--src-ref");
const SRC_REF = refArg === -1 ? "bf1f7ff1cb92faacfdc3b98ba17fb2f93cac59b5" : process.argv[refArg + 1];
const SHA = execFileSync("git", ["-C", SRC, "rev-parse", SRC_REF], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["-C", SRC, "ls-tree", "-r", "--name-only", SHA], {
	encoding: "utf8",
	maxBuffer: 16 * 1024 * 1024,
})
	.trim()
	.split("\n");

const expandBraces = (p) => {
	const m = /\{([^{}]+)\}/u.exec(p);
	if (!m) return [p];
	return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
};
const toRegex = (glob) =>
	new RegExp(
		`^${glob
			.replace(/[.+^$()|[\]\\]/gu, "\\$&")
			.replace(/\*\*/gu, "\u0000")
			.replace(/\*/gu, "[^/]*")
			.replace(/\u0000/gu, ".*")}$`,
		"u",
	);
const patternsOf = (entryPath) => {
	let p = entryPath.split(" (")[0].trim();
	p = p.replace(/\.(\w+)\|(\w+)$/u, ".{$1,$2}"); // "*.svelte|ts" -> "*.{svelte,ts}"
	return expandBraces(p);
};

const entries = [];
for (const f of ["inventory-app.json", "inventory-recipes.json", "inventory-ops.json"]) {
	for (const e of JSON.parse(readFileSync(path.join(BASE, f), "utf8"))) {
		const pats = patternsOf(e.path);
		entries.push({ ...e, inv: f.replace("inventory-", "").replace(".json", ""), pats, glob: pats.some((x) => x.includes("*")) });
	}
}
const hits = new Map(tracked.map((t) => [t, []]));
const entryHits = new Map();
for (const e of entries) {
	let n = 0;
	for (const t of tracked) {
		if (e.pats.some((p) => (p.includes("*") ? toRegex(p).test(t) : p === t))) {
			hits.get(t).push(e);
			n++;
		}
	}
	entryHits.set(e, n);
}

// Resolution rules for files listed more than once.
const SPLIT = {
	"scripts/astro-contract.test.mjs": "split: recipe test (lines 174-201) -> scripts/recipes/built-recipes.test.mjs; the rest -> blog contract test (both adapt)",
	"src/styles/no-script.css": "split: blog rules -> src/styles/blog/no-script.css; 4 recipe rules -> src/styles/recipes/recipes-no-script.css (both adapt)",
	"src/pages/post/[slug]/index.astro": "adapt (blog post page -> src/pages/blog/[slug]/index.astro); the recipe special-casing branch is deleted inside that adapt",
	"vercel.json": "adapt, split: feed/SW/no-store header knowledge -> DST vercel.json; redirect knowledge -> legacy/blogthedata/url-map.json (inv-recipes + inv-ops agree)",
	"src/styles/recipes-theme.css": "adapt (recipes inventory owns it; inv-app's `move` defers to it) -> src/styles/recipes/recipes-theme.css",
};
const resolved = new Map();
const multi = [];
for (const [t, es] of hits) {
	if (es.length === 0) continue;
	if (es.length === 1) {
		resolved.set(t, { disposition: es[0].disposition, inv: es[0].inv, rule: null });
		continue;
	}
	let rule;
	let disposition;
	const specific = es.filter((e) => !e.glob);
	if (SPLIT[t]) {
		rule = SPLIT[t];
		disposition = "adapt";
	} else if (specific.length && new Set(specific.map((e) => e.disposition)).size === 1) {
		disposition = specific[0].disposition;
		rule = `specific entry beats glob: ${disposition} (${specific.map((e) => e.inv).join(", ")})`;
	} else if (new Set(es.map((e) => e.disposition)).size === 1) {
		disposition = es[0].disposition;
		rule = `same disposition in ${es.map((e) => e.inv).join(" + ")}; recipes inventory owns the target`;
	} else {
		disposition = "UNRESOLVED";
		rule = "conflicting dispositions without a rule";
	}
	resolved.set(t, { disposition, inv: es.map((e) => e.inv).join("+"), rule });
	multi.push({ file: t, listed_in: es.map((e) => `${e.inv}:${e.disposition}`), rule });
}
// Brief overrides (decisions-brief.md items 4, 5, 22): where an inventory target or
// disposition contradicts the brief, the brief wins. Applied after resolution.
const BRIEF_OVERRIDES = [
	[/^public\/social\/[^/]+\.svg$/u, "move", "public/blog/social/<same> (brief 4: chrome assets move under /blog/ while BlogLayout uses them; inv-ops dropped 4 and re-homed reddit)"],
	[/^public\/media\/default\.webp$/u, "move", "public/blog/media/default.webp (brief 4; inv-ops kept /media/)"],
	[/^public\/media\/recipes\//u, "move", "public/recipes/media/<same> (brief 5; inv-ops kept /media/recipes/)"],
	[/^\.github\/workflows\/production-smoke\.yml$/u, "drop", "DST copy is the dotagents template; the project discriminator and SRC hardening arrive through the X1 template change and its sync, never a local edit"],
	[/^src\/lib\/components\/ui\/[^/]+\/index\.ts$/u, "drop", "barrel; biome noBarrelFile + DST AGENTS.md (import defining files directly)"],
	[/^src\/lib\/components\/ui\/(?:dialog\/dialog-(?:close|footer|header|trigger)|native-select\/native-select-opt(?:-group|ion)|popover\/popover-(?:close|description|header|title))\.svelte$/u, "drop", "generated part nothing imports (knip unused file in the spike)"],
	[/^\.github\/dependabot\.yml$/u, "drop", "DST's own Dependabot config governs; a github-actions ecosystem is a separate decision (leftover)"],
];
const overridden = [];
for (const [t, v] of resolved) {
	for (const [re, disposition, why] of BRIEF_OVERRIDES) {
		if (re.test(t)) {
			if (v.disposition !== disposition) overridden.push({ file: t, from: v.disposition, to: disposition, why });
			resolved.set(t, { ...v, disposition, rule: v.rule ?? `brief override: ${why}` });
		}
	}
}
// Post reclassification (plan section 1.1): every post B04 rewrites is `adapt`, derived
// mechanically: posts carrying an absolute blogthedata.com URL, plus the 3 posts that drop
// the recipe slug from `related`, plus the 2 heading fixes. The dropped instant-pot post
// stays `drop`. The posts' .markdownlint.json is `adapt` (Biome-formatted on import).
const POSTS = "src/content/posts/";
const absUrlPosts = execFileSync("git", ["-C", SRC, "grep", "-l", "-E", "https?://(www\\.)?blogthedata\\.com", SHA, "--", `${POSTS}*.md`], { encoding: "utf8" })
	.trim()
	.split("\n")
	.filter(Boolean)
	.map((l) => l.slice(SHA.length + 1));
const relatedPosts = ["UI-enhancement-leads-to-major-architecture-changes", "compress-minify-assets-69-percent-faster-page-load", "gis-job-search-resources"].map((s) => `${POSTS}${s}.md`);
const headingPosts = ["conventional-commits", "optimizing-ahrefs-orphan-pages-duplicate-content"].map((s) => `${POSTS}${s}.md`);
const rewritten = new Set([...absUrlPosts, ...relatedPosts, ...headingPosts]);
const overlap = absUrlPosts.length + relatedPosts.length + headingPosts.length - rewritten.size;
const postReclass = [];
for (const t of rewritten) {
	const v = resolved.get(t);
	if (!v) {
		console.error(`RECLASS target not tracked: ${t}`);
		process.exit(1);
	}
	if (v.disposition === "drop") {
		console.error(`RECLASS target is a dropped file: ${t}`);
		process.exit(1);
	}
	if (v.disposition !== "adapt") postReclass.push(t);
	resolved.set(t, { ...v, disposition: "adapt", rule: v.rule ?? "post reclassification: B04 rewrites this post" });
}
const missing = tracked.filter((t) => !resolved.has(t));
const deadEntries = [...entryHits].filter(([, n]) => n === 0).map(([e]) => `${e.inv}: ${e.path}`);
const byDisp = {};
for (const { disposition } of resolved.values()) byDisp[disposition] = (byDisp[disposition] ?? 0) + 1;
const byInv = {};
for (const e of entries) {
	byInv[e.inv] ??= { entries: 0, adapt: 0, move: 0, drop: 0 };
	byInv[e.inv].entries++;
	byInv[e.inv][e.disposition]++;
}
const unresolved = [...resolved].filter(([, v]) => v.disposition === "UNRESOLVED").map(([k]) => k);
const report = {
	source_sha: SHA,
	tracked: tracked.length,
	resolved: resolved.size,
	missing,
	unresolved,
	entries_matching_nothing: deadEntries,
	inventory_entries: byInv,
	files_by_resolved_disposition: byDisp,
	multi_listed: multi,
	brief_overrides_changing_disposition: overridden,
	post_reclassification: {
		absolute_url_posts: absUrlPosts.length,
		related_change_posts: relatedPosts.length,
		heading_fix_posts: headingPosts.length,
		overlap,
		rewritten_posts: rewritten.size,
		moved_to_adapt: postReclass.length,
	},
	files: Object.fromEntries([...resolved].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.disposition])),
};
writeFileSync(path.join(OUT, "inventory-coverage.json"), `${JSON.stringify(report, null, "\t")}\n`);
console.log(
	`tracked=${tracked.length} resolved=${resolved.size} missing=${missing.length} unresolved=${unresolved.length} multi-listed=${multi.length} dead-entries=${deadEntries.length}`,
);
console.log("files by disposition:", JSON.stringify(byDisp));
console.log("entries by inventory:", JSON.stringify(byInv));
console.log(
	`post reclassification: ${absUrlPosts.length} absolute-URL + ${relatedPosts.length} related + ${headingPosts.length} heading - ${overlap} overlap = ${rewritten.size} adapt posts (${postReclass.length} moved from move)`,
);
for (const m of multi) console.log(`MULTI ${m.file} [${m.listed_in.join(", ")}] => ${m.rule}`);
for (const o of overridden) console.log(`OVERRIDE ${o.file}: ${o.from} -> ${o.to} (${o.why})`);
for (const m of missing) console.log(`MISSING ${m}`);
for (const d of deadEntries) console.log(`DEAD-ENTRY ${d}`);
if (missing.length || unresolved.length) process.exit(1);
