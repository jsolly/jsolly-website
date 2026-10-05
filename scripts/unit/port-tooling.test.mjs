import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import it from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

// The temporary blogthedata port tools (scripts/port/, deleted at C0) rewrite
// and re-import production content, so their guarantees are pinned here (plan
// MST-06). Every test builds its own awesome-blog fixture repo and DST tree in
// a temp dir, never reads the real awesome-blog checkout (CI has none) and
// runs the tools as John would, through their CLI with --src and --dst.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT_DIR = join(ROOT, "scripts", "port");
const REAL_LEGACY = join(ROOT, "legacy", "blogthedata");
const POSTS = "src/content/blog/posts";
const DROPPED = "15-minute-dump-and-go-instant-pot-recipes";
const NO_OLD_HOST_HREF = /href="https?:\/\/(?:www\.)?blogthedata\.com/u;
const TAB_INDENTED = /^\{\n\t"/u;
const OLD_RECIPE_MEDIA = /\/media\/recipes\//u;
const LISTS_THE_POST = /how-to-get-perfect-linting-compliance\.md/u;
const NOTHING_CHANGED = /Changed 0 of 2 posts/u;
const THREE_CONTENT_FILES = /3 content file\(s\) changed/u;
const NAMES_THE_CODE_FILE = /src\/lib\/html\.ts/u;
const NAMES_THE_NESTED_POST = /src\/content\/posts\/drafts\/notes\.md/u;
const HISTORY_REWRITTEN = /does not contain the cut/u;
const WARNS_REMOVED = /removed public\/blog\/media\/default\.webp/u;
const REPORTS_EXCLUDED =
	/skipped src\/content\/posts\/15-minute-dump-and-go-instant-pot-recipes\.md/u;
const NAMES_THE_ARCHIVE_POST =
	/src\/content\/posts\/archive\/2019-roundup\.md/u;
const NAMES_THE_EDITED_POST =
	/src\/content\/blog\/posts\/Find-Your-Dream-Job-With-LinkedIn-Boolean-Search\.md/u;
const NAMES_THE_ADMIN_LINK =
	/no jsolly destination for https:\/\/blogthedata\.com\/admin\//u;
const NAMES_PST_106 = /PST-106/u;
const MARKDOWN_LINK_WITH_QUERY =
	/\[django posts\]\(\/blog\/search\/\?searched=django\)/u;
const NAMES_DJG_005 = /DJG-005/u;
const FROZEN_FILES = [
	"legacy/blogthedata/url-map.json",
	"legacy/blogthedata/url-union.json",
	"scripts/port/source.json",
];

// The git environment of a pre-commit hook (GIT_DIR, GIT_INDEX_FILE, …) would
// send fixture commands to the real repo, so every child gets none of it, plus
// a fixture-owned global config with auto-maintenance off and a fixed identity.
function fixture(t) {
	const dir = mkdtempSync(join(tmpdir(), "port-tooling-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const gitConfig = join(dir, "gitconfig");
	writeFileSync(gitConfig, "[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n");
	const env = {
		...Object.fromEntries(
			Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
		),
		GIT_CONFIG_GLOBAL: gitConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Sarah Chen",
		GIT_AUTHOR_EMAIL: "sarah.chen@example.com",
		GIT_COMMITTER_NAME: "Sarah Chen",
		GIT_COMMITTER_EMAIL: "sarah.chen@example.com",
	};
	const src = join(dir, "awesome-blog");
	const dst = join(dir, "jsolly-website");
	const git = (...args) => {
		const result = spawnSync("git", ["-C", src, ...args], {
			env,
			encoding: "utf8",
		});
		if (result.status !== 0) {
			throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
		}
		return result.stdout.trim();
	};
	mkdirSync(src);
	git("init", "-q", "-b", "main");
	const write = (root, files) => {
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
	};
	return {
		src,
		dst,
		// Commits `files` to the fixture awesome-blog and returns the SHA.
		commit(files, message) {
			write(src, files);
			git("add", "-A");
			git("commit", "-q", "-m", message);
			return git("rev-parse", "HEAD");
		},
		removeFromSrc(path) {
			git("rm", "-q", path);
		},
		setOriginMain(sha) {
			git("update-ref", "refs/remotes/origin/main", sha);
		},
		// A parentless copy of `sha`'s tree: origin/main after a force-push.
		rewrittenCopy(sha) {
			return git("commit-tree", `${sha}^{tree}`, "-m", "force-pushed rewrite");
		},
		writeDst(files) {
			write(dst, files);
		},
		readDst(path) {
			return readFileSync(join(dst, path), "utf8");
		},
		source(cutSha, freezeSha = null) {
			write(dst, {
				"scripts/port/source.json": `${JSON.stringify({ cut_sha: cutSha, freeze_sha: freezeSha }, null, "\t")}\n`,
			});
		},
		copyRealMap() {
			mkdirSync(join(dst, "legacy", "blogthedata"), { recursive: true });
			for (const name of ["url-map.json", "url-union.json"]) {
				cpSync(
					join(REAL_LEGACY, name),
					join(dst, "legacy", "blogthedata", name),
				);
			}
		},
		// rewrite-content reads only DST; every other tool reads SRC too.
		run(tool, ...args) {
			const locations =
				tool === "rewrite-content.mjs"
					? ["--dst", dst]
					: ["--src", src, "--dst", dst];
			return spawnSync(
				process.execPath,
				[join(PORT_DIR, tool), ...args, ...locations],
				{ env, encoding: "utf8" },
			);
		},
	};
}

function post({ slug, draft = "false", related = [], body }) {
	const draftLine = draft === null ? "" : `draft: ${draft}\n`;
	const relatedBlock =
		related.length === 0
			? ""
			: `related:\n${related.map((item) => `  - ${item}`).join("\n")}\n`;
	return `---\nslug: ${slug}\ntitle: "${slug.replaceAll("-", " ")}"\ncategory: web-dev\n${draftLine}published: "2023-03-14T09:26:53Z"\nauthor: John Solly\n${relatedBlock}---\n${body}\n`;
}

// A post carrying one of each B04 rewrite, written as the SRC posts are.
const REWRITE_POST = post({
	slug: "how-to-get-perfect-linting-compliance",
	related: [DROPPED, "how-to-get-100-percent-unit-test-coverage"],
	body: [
		'<p>After my <a target="_blank" rel="noopener noreferrer" href="https://blogthedata.com/post/google-lighthouse-perfect-score/">perfect Lighthouse score</a> I read the <a target="_blank" rel="noopener noreferrer" href="https://www.blogthedata.com/post/optimizing-gpt-for-nlp-tips-and-tricks/#directives">directive section</a> again.</p>',
		"",
		'<p>My old favourites list <a href="https://blogthedata.com/post/sollys-favorite-youtube-channels-and-podcasts/">moved</a>, and every post is on <a href="https://blogthedata.com/all-posts/">blogthedata.com/all-posts</a>; crawlers read <a href="https://blogthedata.com/robots.txt">my robots.txt</a>.</p>',
		"",
		'<p>Reset your password <a target="_blank" rel="noopener noreferrer" href="https://blogthedata.com/password-reset/">here</a>.</p>',
		"",
		'## <img class="image_resized" src="https://d1d7p8ufhgz4ld.cloudfront.net/media/post_imgs/pylint_score.png" alt="Pylint 10.00/10">',
		"",
		"<h2>&nbsp;</h2>",
		"",
		"Search the archive: [django posts](http://www.blogthedata.com/search/?searched=django).",
		"",
		'<p>Next up: <a href="https://blogthedata.com/post/mapping-flood-risk-with-postgis/">flood maps</a>.</p>',
		"",
		"## Results",
	].join("\n"),
});

// Published after the cut: no url-map row until C0's url-map-sync, which the
// plan runs after rewrite-content.
const LATER_POST = post({
	slug: "mapping-flood-risk-with-postgis",
	body: "<p>PostGIS makes flood zones queryable.</p>",
});

it("B04's rewrite, run again over the rewritten posts at C0, changes nothing", (t) => {
	const tree = fixture(t);
	tree.copyRealMap();
	tree.writeDst({
		[`${POSTS}/how-to-get-perfect-linting-compliance.md`]: REWRITE_POST,
		[`${POSTS}/mapping-flood-risk-with-postgis.md`]: LATER_POST,
	});

	const dryRun = tree.run("rewrite-content.mjs", "--dry-run");
	assert.equal(dryRun.status, 0, dryRun.stderr);
	assert.match(dryRun.stdout, LISTS_THE_POST);
	assert.equal(
		tree.readDst(`${POSTS}/how-to-get-perfect-linting-compliance.md`),
		REWRITE_POST,
		"a dry run writes nothing",
	);

	const first = tree.run("rewrite-content.mjs");
	assert.equal(first.status, 0, first.stderr);
	const rewritten = tree.readDst(
		`${POSTS}/how-to-get-perfect-linting-compliance.md`,
	);
	assert.ok(
		rewritten.includes('href="/blog/google-lighthouse-perfect-score/"'),
	);
	assert.ok(
		rewritten.includes(
			'href="/blog/optimizing-gpt-for-nlp-tips-and-tricks/#directives"',
		),
	);
	assert.ok(
		rewritten.includes(
			'href="/blog/my-favorite-youtube-channels-podcasts-newsletters/"',
		),
		"a renamed post goes straight to its final URL",
	);
	assert.ok(
		rewritten.includes('href="/blog/all-posts/">blogthedata.com/all-posts</a>'),
	);
	assert.ok(rewritten.includes('href="/robots.txt"'));
	assert.match(
		rewritten,
		MARKDOWN_LINK_WITH_QUERY,
		"a Markdown http:// link keeps its query",
	);
	assert.ok(
		rewritten.includes('href="/blog/mapping-flood-risk-with-postgis/"'),
		"a post with no url-map row yet resolves through its DST file",
	);
	assert.ok(rewritten.includes("<p>Reset your password here.</p>"));
	assert.doesNotMatch(rewritten, NO_OLD_HOST_HREF);
	assert.ok(!rewritten.includes(DROPPED));
	assert.ok(
		rewritten.includes("  - how-to-get-100-percent-unit-test-coverage\n"),
	);
	assert.ok(rewritten.includes('\n<img class="image_resized" src='));
	assert.ok(!rewritten.includes("<h2>&nbsp;</h2>"));
	assert.ok(rewritten.includes("## Results"));

	const second = tree.run("rewrite-content.mjs");
	assert.equal(second.status, 0, second.stderr);
	assert.match(second.stdout, NOTHING_CHANGED);
	assert.equal(
		tree.readDst(`${POSTS}/how-to-get-perfect-linting-compliance.md`),
		rewritten,
	);
});

it("Rewriting posts never touches the migration receipts, the URL map or the real tree", (t) => {
	const tree = fixture(t);
	tree.copyRealMap();
	const receipts = {
		"src/content/redirects.json": `${JSON.stringify(
			[
				{
					source: "/post/sollys-favorite-youtube-channels-and-podcasts/",
					destination:
						"/post/my-favorite-youtube-channels-podcasts-newsletters/",
					legacyId: 1,
				},
			],
			null,
			2,
		)}\n`,
		"src/content/migration-receipt.json": `${JSON.stringify(
			{
				posts: 106,
				publishedPaths: [
					"https://www.blogthedata.com/post/google-lighthouse-perfect-score/",
				],
			},
			null,
			2,
		)}\n`,
		[`${POSTS}/intentional-rewrites.json`]: `{"rewrites":[{"url":"https://blogthedata.com/post/${DROPPED}/"}]}\n`,
		[`${POSTS}/.markdownlint.json`]: '{\n\t"MD033": false\n}\n',
	};
	tree.writeDst({
		...receipts,
		[`${POSTS}/how-to-get-perfect-linting-compliance.md`]: REWRITE_POST,
		[`${POSTS}/mapping-flood-risk-with-postgis.md`]: LATER_POST,
	});
	const urlMap = tree.readDst("legacy/blogthedata/url-map.json");
	const hash = (path) =>
		createHash("sha256")
			.update(readFileSync(join(ROOT, path)))
			.digest("hex");
	const realBefore = FROZEN_FILES.map(hash);
	const honeypot = post({
		slug: "admin-honeypot-page-to-catch-hackers",
		body: '<p>Try <a href="https://blogthedata.com/admin/">the admin page</a>.</p>',
	});
	const honeypotPath = `${POSTS}/admin-honeypot-page-to-catch-hackers.md`;
	tree.writeDst({ [honeypotPath]: honeypot });

	const refused = tree.run("rewrite-content.mjs");

	assert.equal(refused.status, 1);
	assert.match(refused.stderr, NAMES_THE_ADMIN_LINK);
	assert.equal(tree.readDst(honeypotPath), honeypot);
	assert.equal(
		tree.readDst(`${POSTS}/how-to-get-perfect-linting-compliance.md`),
		REWRITE_POST,
		"an unresolvable link anywhere writes nothing anywhere",
	);
	rmSync(join(tree.dst, honeypotPath));

	const result = tree.run("rewrite-content.mjs");

	assert.equal(result.status, 0, result.stderr);
	assert.notEqual(
		tree.readDst(`${POSTS}/how-to-get-perfect-linting-compliance.md`),
		REWRITE_POST,
		"the post itself was rewritten",
	);
	for (const [path, content] of Object.entries(receipts)) {
		assert.equal(tree.readDst(path), content, `${path} is byte-identical`);
	}
	assert.equal(tree.readDst("legacy/blogthedata/url-map.json"), urlMap);
	assert.deepEqual(
		FROZEN_FILES.map(hash),
		realBefore,
		"the real tree is untouched",
	);
});

it("At C0, url-map-sync adds rows for content published since the cut, never removes one and skips drafts", (t) => {
	const tree = fixture(t);
	const existing = {
		"src/content/posts/12-questions-you-should-ask-at-your-next-interview.md":
			post({
				slug: "12-questions-you-should-ask-at-your-next-interview",
				body: "<p>An interview is a two-way conversation.</p>",
			}),
		"src/content/categories/Geodev.json":
			'{\n  "slug": "Geodev",\n  "name": "GeoDev"\n}',
		"src/components/recipes/recipes.json": JSON.stringify({
			version: 1,
			recipes: [{ id: "chicken-posole" }],
		}),
		"public/media/default.webp": "RIFF-default-webp",
	};
	const cut = tree.commit(existing, "content at the cut");
	const freeze = tree.commit(
		{
			"src/content/posts/mapping-flood-risk-with-postgis.md": post({
				slug: "mapping-flood-risk-with-postgis",
				body: "<p>PostGIS makes flood zones queryable.</p>",
			}),
			"src/content/posts/notes-on-vector-tiles.md": post({
				slug: "notes-on-vector-tiles",
				draft: "true",
				body: "<p>Not ready.</p>",
			}),
			"src/content/posts/half-written-stac-guide.md": post({
				slug: "half-written-stac-guide",
				draft: null,
				body: "<p>PagesCMS saved this without a draft key.</p>",
			}),
			"src/components/recipes/recipes.json": JSON.stringify({
				version: 1,
				recipes: [{ id: "chicken-posole" }, { id: "miso-glazed-salmon-bowls" }],
			}),
			"public/media/recipes/miso-glazed-salmon-bowls-960.webp":
				"RIFF-salmon-webp",
		},
		"content edits before the freeze",
	);
	tree.copyRealMap();
	tree.source(cut, freeze);
	const before = JSON.parse(tree.readDst("legacy/blogthedata/url-map.json"));
	const unionBefore = JSON.parse(
		tree.readDst("legacy/blogthedata/url-union.json"),
	);

	const result = tree.run("url-map-sync.mjs");

	assert.equal(result.status, 0, result.stderr);
	const after = JSON.parse(tree.readDst("legacy/blogthedata/url-map.json"));
	const unionAfter = JSON.parse(
		tree.readDst("legacy/blogthedata/url-union.json"),
	);
	assert.deepEqual(after.rows.slice(0, before.rows.length), before.rows);
	assert.deepEqual(
		after.rows
			.slice(before.rows.length)
			.map((row) => [row.source, row.destination, row.action]),
		[
			[
				"/post/mapping-flood-risk-with-postgis/",
				"https://www.jsolly.com/blog/mapping-flood-risk-with-postgis/",
				"redirect-301",
			],
			[
				"/recipes/miso-glazed-salmon-bowls/",
				"https://www.jsolly.com/recipes/miso-glazed-salmon-bowls/",
				"redirect-301",
			],
			[
				"/media/recipes/miso-glazed-salmon-bowls-960.webp",
				"https://www.jsolly.com/recipes/media/miso-glazed-salmon-bowls-960.webp",
				"redirect-301",
			],
		],
		"drafts and posts without a draft key get no row",
	);
	assert.deepEqual(
		after.rows.slice(before.rows.length).map((row) => row.id),
		["PST-112", "RCP-026", "MED-046"],
		"each prefix continues at its highest id, zero-padded",
	);
	assert.equal(
		new Set(after.rows.map((row) => row.id)).size,
		after.rows.length,
		"row ids stay unique",
	);
	assert.equal(after.meta.freeze_sha, freeze);
	const newPost = after.rows.find(
		(row) => row.source === "/post/mapping-flood-risk-with-postgis/",
	);
	const paths = new Map(
		unionAfter.elements.map((element) => [element.path, element]),
	);
	assert.equal(
		paths.get("/post/mapping-flood-risk-with-postgis/")?.row_id,
		newPost.id,
	);
	assert.equal(
		paths.get("/post/mapping-flood-risk-with-postgis/index.html")?.row_id,
		newPost.id,
	);
	assert.ok(!paths.has("/post/notes-on-vector-tiles/"));
	for (const element of unionBefore.elements) {
		assert.ok(
			unionAfter.elements.some((other) => isDeepStrictEqual(other, element)),
			`${element.path} survives`,
		);
	}

	const mapText = tree.readDst("legacy/blogthedata/url-map.json");
	const unionText = tree.readDst("legacy/blogthedata/url-union.json");
	const again = tree.run("url-map-sync.mjs");
	assert.equal(again.status, 0, again.stderr);
	assert.equal(tree.readDst("legacy/blogthedata/url-map.json"), mapText);
	assert.equal(tree.readDst("legacy/blogthedata/url-union.json"), unionText);

	// A post republished where the map deliberately 404s (PST-106, J10).
	const revived = tree.commit(
		{
			"src/content/posts/blogthedata-open-source-blog-portfolio.md": post({
				slug: "blogthedata-open-source-blog-portfolio",
				body: "<p>The blog is open source again.</p>",
			}),
		},
		"republish a deleted post",
	);
	tree.source(cut, revived);
	const exactRefusal = tree.run("url-map-sync.mjs");
	assert.notEqual(exactRefusal.status, 0);
	assert.match(exactRefusal.stderr, NAMES_PST_106);
	assert.equal(tree.readDst("legacy/blogthedata/url-map.json"), mapText);
	assert.equal(tree.readDst("legacy/blogthedata/url-union.json"), unionText);

	// A new category lands inside the Django-era stays-404 pattern DJG-005.
	tree.removeFromSrc(
		"src/content/posts/blogthedata-open-source-blog-portfolio.md",
	);
	const category = tree.commit(
		{
			"src/content/categories/data-engineering.json":
				'{\n  "slug": "data-engineering",\n  "name": "Data engineering"\n}',
		},
		"a new category",
	);
	tree.source(cut, category);
	const patternRefusal = tree.run("url-map-sync.mjs");
	assert.notEqual(patternRefusal.status, 0);
	assert.match(patternRefusal.stderr, NAMES_DJG_005);
	assert.equal(tree.readDst("legacy/blogthedata/url-map.json"), mapText);
	assert.equal(tree.readDst("legacy/blogthedata/url-union.json"), unionText);
});

it("freeze-check fails on a code change in awesome-blog after the cut and passes on content edits", (t) => {
	const tree = fixture(t);
	const cut = tree.commit(
		{
			"src/lib/html.ts":
				"export const legacyMedia = 'https://d1d7p8ufhgz4ld.cloudfront.net/media/';\n",
			"src/content/posts/conventional-commits.md": post({
				slug: "conventional-commits",
				body: "<p>Commit messages with a type.</p>",
			}),
		},
		"the cut",
	);
	tree.source(cut);
	const content = tree.commit(
		{
			"src/content/posts/conventional-commits.md": post({
				slug: "conventional-commits",
				body: "<p>Commit messages with a type and a scope.</p>",
			}),
			"src/components/recipes/recipes.json": '{"version":1,"recipes":[]}',
			"public/media/recipes/chicken-posole-960.webp": "RIFF-posole-webp",
		},
		"a PagesCMS edit and a new recipe photo",
	);
	tree.setOriginMain(content);

	const contentOnly = tree.run("freeze-check.mjs");
	assert.equal(contentOnly.status, 0, contentOnly.stderr);
	assert.match(contentOnly.stdout, THREE_CONTENT_FILES);

	// Under a content root, but no path-map entry carries it, so --resync could
	// not import it either.
	const nested = tree.commit(
		{
			"src/content/posts/drafts/notes.md": post({
				slug: "notes",
				body: "<p>A nested draft.</p>",
			}),
		},
		"a post in a subdirectory",
	);
	tree.setOriginMain(nested);
	const nestedChange = tree.run("freeze-check.mjs");
	assert.notEqual(nestedChange.status, 0);
	assert.match(nestedChange.stderr, NAMES_THE_NESTED_POST);

	const code = tree.commit(
		{
			"src/lib/html.ts":
				"export const legacyMedia = 'https://images.example.com/media/';\n",
		},
		"a sneaky code change during the freeze",
	);
	tree.setOriginMain(code);

	const codeChange = tree.run("freeze-check.mjs");
	assert.notEqual(codeChange.status, 0);
	assert.match(codeChange.stderr, NAMES_THE_CODE_FILE);

	tree.setOriginMain(tree.rewrittenCopy(content));
	const rewritten = tree.run("freeze-check.mjs");
	assert.notEqual(rewritten.status, 0);
	assert.match(rewritten.stderr, HISTORY_REWRITTEN);
});

it("B03's import applies the path map, copies the posts' .markdownlint.json and C0's resync brings later edits", (t) => {
	const tree = fixture(t);
	const lint = '{\n  "MD013": false,\n  "MD033": false\n}\n';
	const category =
		'{\n  "slug": "Geodev",\n  "name": "GeoDev",\n  "legacyId": 4\n}\n';
	const recipes = `${JSON.stringify(
		{
			version: 1,
			recipes: [
				{
					id: "chicken-posole",
					image: "/media/recipes/chicken-posole-960.webp",
					srcset:
						"/media/recipes/chicken-posole-480.webp 480w, /media/recipes/chicken-posole-960.webp 960w",
				},
			],
		},
		null,
		2,
	)}\n`;
	const nutrition = '{\n  "foods": {"salmon": {"kcal": 208}}\n}\n';
	const posts = {
		"src/content/posts/Find-Your-Dream-Job-With-LinkedIn-Boolean-Search.md":
			post({
				slug: "Find-Your-Dream-Job-With-LinkedIn-Boolean-Search",
				body: "<p>Boolean search finds the roles you want.</p>",
			}),
		[`src/content/posts/${DROPPED}.md`]: post({
			slug: DROPPED,
			body: "<p>Generated.</p>",
		}),
	};
	const cut = tree.commit(
		{
			...posts,
			"src/content/posts/.markdownlint.json": lint,
			"src/content/categories/Geodev.json": category,
			"src/components/recipes/recipes.json": recipes,
			"src/components/recipes/nutrition-data.json": nutrition,
			"public/media/default.webp": "RIFF-default-webp",
			"public/media/recipes/chicken-posole-960.webp": "RIFF-posole-webp",
		},
		"the cut",
	);
	tree.source(cut);

	const imported = tree.run(
		"import-awesome-blog.mjs",
		"posts",
		"categories",
		"recipe-data",
		"blog-media",
		"recipe-media",
	);

	assert.equal(imported.status, 0, imported.stderr);
	const dreamJob = `${POSTS}/Find-Your-Dream-Job-With-LinkedIn-Boolean-Search.md`;
	assert.equal(
		tree.readDst(dreamJob),
		posts[
			"src/content/posts/Find-Your-Dream-Job-With-LinkedIn-Boolean-Search.md"
		],
	);
	assert.ok(
		!existsSync(join(tree.dst, POSTS, `${DROPPED}.md`)),
		"the recipe post is dropped (J7)",
	);
	const lintCopy = tree.readDst(`${POSTS}/.markdownlint.json`);
	assert.match(lintCopy, TAB_INDENTED, "the dotfile is Biome-formatted");
	assert.deepEqual(JSON.parse(lintCopy), JSON.parse(lint));
	const categoryCopy = tree.readDst("src/content/blog/categories/Geodev.json");
	assert.equal(
		categoryCopy,
		JSON.stringify(JSON.parse(category), null, 2),
		"PagesCMS's own shape",
	);
	const recipesCopy = tree.readDst("src/components/recipes/recipes.json");
	assert.doesNotMatch(recipesCopy, OLD_RECIPE_MEDIA);
	assert.deepEqual(
		JSON.parse(recipesCopy),
		JSON.parse(recipes.replaceAll("/media/recipes/", "/recipes/media/")),
	);
	assert.match(recipesCopy, TAB_INDENTED);
	const nutritionCopy = tree.readDst(
		"src/components/recipes/nutrition-data.json",
	);
	assert.match(nutritionCopy, TAB_INDENTED);
	assert.deepEqual(JSON.parse(nutritionCopy), JSON.parse(nutrition));
	assert.equal(
		tree.readDst("public/blog/media/default.webp"),
		"RIFF-default-webp",
	);
	assert.equal(
		tree.readDst("public/recipes/media/chicken-posole-960.webp"),
		"RIFF-posole-webp",
	);
	assert.ok(!existsSync(join(tree.dst, "public/blog/media/recipes")));

	// A later step's hand edit survives a plain re-import; --overwrite resets it.
	const handEdited = `${tree.readDst(dreamJob)}<p>Edited by hand in B04.</p>\n`;
	tree.writeDst({ [dreamJob]: handEdited });
	const guarded = tree.run("import-awesome-blog.mjs", "posts");
	assert.equal(guarded.status, 1);
	assert.match(guarded.stderr, NAMES_THE_EDITED_POST);
	assert.equal(tree.readDst(dreamJob), handEdited);
	const overwritten = tree.run(
		"import-awesome-blog.mjs",
		"posts",
		"--overwrite",
	);
	assert.equal(overwritten.status, 0, overwritten.stderr);
	assert.equal(
		tree.readDst(dreamJob),
		posts[
			"src/content/posts/Find-Your-Dream-Job-With-LinkedIn-Boolean-Search.md"
		],
	);

	const later = post({
		slug: "Find-Your-Dream-Job-With-LinkedIn-Boolean-Search",
		body: "<p>Boolean search finds the roles you want, now with NOT.</p>",
	});
	const laterCategory =
		'{\n  "slug": "Geodev",\n  "name": "Geospatial development",\n  "legacyId": 4\n}\n';
	const laterRecipes = `${JSON.stringify(
		{
			version: 1,
			recipes: [
				{
					id: "chicken-posole",
					image: "/media/recipes/chicken-posole-960.webp",
					guide: `/post/${DROPPED}/#chicken-posole`,
				},
				{
					id: "miso-glazed-salmon-bowls",
					image: "/media/recipes/miso-glazed-salmon-bowls-960.webp",
				},
			],
		},
		null,
		2,
	)}\n`;
	tree.removeFromSrc("public/media/default.webp");
	const freeze = tree.commit(
		{
			"src/content/categories/Geodev.json": laterCategory,
			"src/components/recipes/recipes.json": laterRecipes,
			[`src/content/posts/${DROPPED}.md`]: post({
				slug: DROPPED,
				body: "<p>Regenerated.</p>",
			}),
			"src/content/posts/Find-Your-Dream-Job-With-LinkedIn-Boolean-Search.md":
				later,
			"src/content/posts/stac-catalogs-for-beginners.md": post({
				slug: "stac-catalogs-for-beginners",
				body: "<p>STAC indexes imagery.</p>",
			}),
			"src/lib/html.ts": "export const ignoredByResync = true;\n",
		},
		"edits during the freeze",
	);
	tree.setOriginMain(freeze);

	const resync = tree.run("import-awesome-blog.mjs", "--resync");

	assert.equal(resync.status, 0, resync.stderr);
	assert.equal(tree.readDst(dreamJob), later);
	assert.ok(
		existsSync(join(tree.dst, POSTS, "stac-catalogs-for-beginners.md")),
	);
	assert.ok(!existsSync(join(tree.dst, "public/blog/media/default.webp")));
	assert.match(resync.stderr, WARNS_REMOVED);
	assert.ok(
		!existsSync(join(tree.dst, "src/lib/html.ts")),
		"resync brings content only",
	);
	assert.equal(
		JSON.parse(tree.readDst("scripts/port/source.json")).freeze_sha,
		freeze,
	);
	assert.match(resync.stdout, REPORTS_EXCLUDED);
	assert.ok(!existsSync(join(tree.dst, POSTS, `${DROPPED}.md`)));
	assert.equal(
		tree.readDst("src/content/blog/categories/Geodev.json"),
		JSON.stringify(JSON.parse(laterCategory), null, 2),
		"the resynced category keeps PagesCMS's shape",
	);
	const resyncedRecipes = tree.readDst("src/components/recipes/recipes.json");
	assert.doesNotMatch(resyncedRecipes, OLD_RECIPE_MEDIA);
	assert.match(resyncedRecipes, TAB_INDENTED);
	assert.deepEqual(
		JSON.parse(resyncedRecipes),
		JSON.parse(
			laterRecipes
				.replaceAll("/media/recipes/", "/recipes/media/")
				.replaceAll(`/post/${DROPPED}/`, "/recipes/"),
		),
		"the old recipe post link keeps its #fragment on /recipes/",
	);

	// A content-root path no entry carries stops the resync before any write.
	tree.setOriginMain(
		tree.commit(
			{
				"src/content/posts/archive/2019-roundup.md": post({
					slug: "2019-roundup",
					body: "<p>The year in review.</p>",
				}),
			},
			"an archived post in a subdirectory",
		),
	);
	const unmapped = tree.run("import-awesome-blog.mjs", "--resync");
	assert.equal(unmapped.status, 1);
	assert.match(unmapped.stderr, NAMES_THE_ARCHIVE_POST);
	assert.equal(
		JSON.parse(tree.readDst("scripts/port/source.json")).freeze_sha,
		freeze,
	);
});

it("Code samples in posts stay byte-identical while the prose around them is rewritten", (t) => {
	const tree = fixture(t);
	tree.copyRealMap();
	const samples = [
		'<code>&lt;link rel="canonical" href="https://www.blogthedata.com/"&gt;</code>',
		'<pre><code class="language-html">&lt;script src="/static/local.js"&gt;&lt;/script&gt;\n<a href="https://blogthedata.com/post/google-lighthouse-audit/">kept</a></code></pre>',
		'`<a href="https://blogthedata.com/post/free-cdn-for-17x-speed/">inline</a>`',
		'```html\n<a href="https://blogthedata.com/password-reset/">fenced</a>\n## <img src="x.png">\n```',
		["<pre>", "<h2>&nbsp;</h2>", "$ dig ns blogthedata.com", "</pre>"].join(
			"\n",
		),
	];
	const text = post({
		slug: "optimizing-ahrefs-orphan-pages-duplicate-content",
		body: [
			'<p>I <a href="https://blogthedata.com/post/implement-infinite-scroll-in-django-with-htmx/">implemented infinite scroll</a> and every page declared</p>',
			...samples.map((sample) => `${sample}\n`),
			'<p>See <a href="https://blogthedata.com/post/free-cdn-for-17x-speed/">the CDN post</a>.</p>',
		].join("\n"),
	});
	tree.writeDst({
		[`${POSTS}/optimizing-ahrefs-orphan-pages-duplicate-content.md`]: text,
	});

	const result = tree.run("rewrite-content.mjs");

	assert.equal(result.status, 0, result.stderr);
	const rewritten = tree.readDst(
		`${POSTS}/optimizing-ahrefs-orphan-pages-duplicate-content.md`,
	);
	for (const sample of samples) {
		assert.ok(rewritten.includes(sample), `kept verbatim: ${sample}`);
	}
	assert.ok(
		rewritten.includes(
			'href="/blog/implement-infinite-scroll-in-django-with-htmx/"',
		),
	);
	assert.ok(
		rewritten.includes(
			'<p>See <a href="/blog/free-cdn-for-17x-speed/">the CDN post</a>.</p>',
		),
	);
});
