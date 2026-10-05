# inv-app notes: awesome-blog application layer vs jsolly-website

SRC = /Users/johnsolly/code/awesome-blog @ bf1f7ff1 (main). DST = /Users/johnsolly/code/jsolly-website @ 5694e76 (main).
Scope: 187 tracked files (src/** minus recipes components/pages and 3 json receipts, plus astro.config.mjs, svelte.config.js, tsconfig.json, components.json, package.json, package-lock.json). `inventory-app.json` has 54 entries (groups where homogeneous); a script verified every assigned file is covered exactly once (40 adapt, 11 drop, 3 move entries).

Evidence legend: [V] verified by command or build in a scratch clone, [F] read from a file (cited), [U] UNVERIFIED.

## 0. How the evidence was produced (reproducible)

All scratch work is under `.../scratchpad/merge-plan/clones/inv-app/` (outside both checkouts):

- `awesome-blog/` and `jsolly-website/`: `git clone --local -c core.hooksPath=/dev/null` + `npm ci --ignore-scripts`. `npm run build` ran green in both (SRC: 141 pages; DST: 7 pages incl. its built-csp test).
- `proto/`: a throwaway copy of DST with the blog ported mechanically (collections, lib, components, a `BlogBase` layout, pages under `src/pages/blog/`, `/post/<slug>/` rewritten to `/blog/<slug>/`, blog astro config merged in, recipes stripped). It is NOT a proposed implementation; it exists to surface breakage. Results below marked [V-proto].
- Helper scripts in `.../merge-plan/work/` (posts-analysis.mjs, csp-style-check.mjs, ids-diff.mjs, neg-test.mts, build-inventory-app.py) and raw outputs (out-posts.json, out-frontmatter.json, biome-lint.json in clones/inv-app/).
- `.migration-work/` and `~/.local/share/blogthedata-migration/` were not read. SRC filesystem was never walked; only `git ls-files`/`git grep`.

## 1. Findings that change the plan (ranked)

1. **DST's Vercel header CSP blocks the blog's images.** `vercel.json:45` = `img-src 'self' data:`; blog needs the cloudfront host: 105 hero images + 99 inline `<img>` + 9 markdown images all come from `d1d7p8ufhgz4ld.cloudfront.net` (the only remote image host in bodies; `git grep` + node scan). Both the header and the Astro meta CSP are enforced (intersection), so BOTH must change. Narrowing to the one host is possible (SRC currently allows all `https:`). [V]
2. **DST middleware returns HTTP 406 to feed readers.** `middleware.ts` runs on every path; `shouldNegotiate('/blog/rss/')` is true (no extension) and `preferredType('application/rss+xml, application/atom+xml, application/xml, text/xml')` is `null` -> `notAcceptable()` 406. With `*/*` anywhere it is fine. Same file [F src/lib/agent-response.ts:35-50, src/content/agent-pages.ts:1-15]: `Accept: text/markdown` on any `/blog/**` page would return the 404 Markdown body because `agent-pages.ts` knows 5 pages. Fix: exempt `/blog/rss/`, `/blog/atom/` (and decide for pages) in `shouldNegotiate`; add a unit test in `src/lib/accept-negotiate.test.ts`. [V via src/lib/accept-negotiate.ts executed with --experimental-strip-types]
3. **Feed identity / re-flood.** `src/lib/feeds.ts`: RSS `<link>`+`<guid>` and Atom `<id>`+`<link>` are absolute `https://www.blogthedata.com/post/<slug>/`; guid has no `isPermaLink` (defaults to true); channel link `…/rss/`; Atom feed `<id>` `…/atom/`. Feeds carry only the 5 most recently UPDATED posts. Changing host/path changes every guid/id => up to 5 items re-appear as new for every subscriber, plus the feed id changes. Mitigation: keep legacy ids for existing posts (`<guid isPermaLink="false">` / Atom `<id>` = old URL string), keep old Atom feed `<id>`, 301 `/rss/` and `/atom/` to `/blog/rss/` and `/blog/atom/` (live: `/rss` -> 308 `/rss/`, `/rss/` serves `application/rss+xml`; [V] curl). Also today the instant-pot post is item #2 in the feed (`dist/rss`).
4. **DST `process-html.mjs` mutates blog pages.** It runs on every built `.html` (JSDOM parse/serialize + html-minifier-terser `removeComments`, `collapseWhitespace`). Measured on the proto build vs the SRC build: (a) all Svelte SSR hydration markers (`<!--[-->`, `<!--]-->`, `<!---->`, `<!--[0-->`) are deleted (0 comments left; SRC index had 42+). Ported `scripts/browse.test.mjs` still passes (Svelte recovers by re-rendering) but this is the same hazard DST's nav island already lives with; (b) whitespace between inline elements collapses in 19 of 105 article bodies and one inline `<code>` loses its leading space (`how-to-create-subtle-shaking-navbar-links`); `<pre>` blocks are intact; (c) it adds ids to every h2/h3/h4 without one, including SSR'd card titles in the PostCards island (ids like `mastering-intuition-pumps-essential-terms-|-a-comprehensive-guide`) and two `#`-only article headings where SRC emitted `id=""` (now `id="#"`). Heading ids inside article bodies are otherwise identical across 346 headings. Options: exclude `dist/blog/**` from minify/comment-stripping, or run only the id pass. [V-proto]
5. **CSP can be satisfied, with explicit config.** Needed in `astro.config.ts`: SRC's directive list (img-src, frame-src for 4 hosts, connect-src, form-action, object-src, base-uri, font-src) and `markdown.syntaxHighlight: 'prism'` (without it Astro warns that Shiki inline styles break CSP, [V-proto build log]). SRC's element/attribute `styleDirective` split gives `style-src 'self'; style-src-elem 'self' <hashes>; style-src-attr 'unsafe-inline'` ([V] SRC dist). DST's plain form works too: in the proto, DST's form emitted no style hashes, so `'unsafe-inline'` stays effective. Recommend SRC's (tighter). Post bodies contain 220 inline `style=` attributes in 47 files (sanitizer allows 39 style properties), so attribute styles must stay allowed (`style-src-attr 'unsafe-inline'`, or `'unsafe-inline'` in DST's plain form as long as no style hashes are emitted). A check over all 124 built proto pages: every inline `<script>` and `<style>` hashes into the page's script-src / style-src-elem after process-html (0 mismatches), and all 124 pages share one policy shape. DST's `scripts/built-csp.test.mjs` only checks scripts: extend it to inline styles and to `img-src`/`frame-src` presence. [V-proto, csp-style-check.mjs]
6. **Biome / lint gate is the largest mechanical cost.** DST runs `biome ci . --error-on-warnings` with ~150 rules. On the ported files (proto, `biome lint`): 270 errors + 18 warnings; by rule: useLayeredStyles 183 (all blog CSS is unlayered), useTopLevelRegex 44 (42 in html.ts), useNamedCaptureGroup 6, useImportExtensions 6, noUndeclaredDependencies 6, useAnchorContent 8, noImportantStyles 14 (warnings = errors under --error-on-warnings), noDescendingSpecificity 4, noShadow 3, useImportsFirst 3, useUnicodeRegex 2, useDomQuerySelector 2, useSemanticElements 2, noInvalidPositionAtImportRule 1, noDuplicateSelectors 1, noUnsafeTypeAssertion 1, noAstroSetHtmlDirective 1, useAriaPropsSupportedByRole 1. `biome check` also flags 26 files for formatting (global.css is one 6 KB line; all JSON incl. `.markdownlint.json`; TS/CSS use tabs in DST). Biome ignores `.md` (posts unaffected). [V-proto]
7. **Type gates.** `astro check` (DST strict flags) on the port: 2 errors (html.ts `attrs.src`/`attrs.title` index-signature). `svelte-check` (not in DST): 3 errors (the same 2 + `ui/input.svelte` imports `WithElementRef` from `utils.js`, which DST moved to `ui-types.ts`). DST `check:ts` does not cover `.svelte`; add svelte-check or islands go unchecked. [V-proto]
8. **`yaml` dependency breaks DST's overrides.** DST `overrides.yaml: ">=2.8.3"` => `npm i yaml@x` fails with `EOVERRIDE`. `"yaml": "$yaml"` in overrides + direct dep works (npm i succeeded). `src/lib/frontmatter.ts` and `post-loader.ts` need the `yaml` package (PagesCMS unquoted timestamps). [V-proto]
9. **Knip is cheap.** Proto knip: 2 findings only (`feedPosts` export in feeds.ts, `legacyMedia` export in html.ts). Unused shadcn files (dialog-close/footer/header/trigger, popover-close/description/header/title, native-select option/opt-group, all `index.ts` barrels) would be flagged as unused files if bulk-copied from the generator output. `knip.json` entry already covers `scripts/**/*.mjs`. [V-proto, F]
10. **Content invariants worth preserving**: 106 posts, all `draft:false` (schema default is `true`: a missing key = draft); filename == slug; 22 slugs contain uppercase; no case-insensitive duplicates; no collisions with reserved routes; 6 categories (`Geodev` capitalised; `uncategorized` has 0 posts); `related` has no dangling refs today, but a dangling ref is silently dropped at render, so removing the instant-pot post (referenced by 3 posts) would NOT fail the build => add a validation. [V]

## 2. Content collections ([F] src/content.config.ts, src/lib/content.ts, post-loader.ts, frontmatter.ts)

- `posts`: custom loader = `glob({pattern:'*.md', base:'./src/content/posts', generateId:({entry})=>entry})` whose `parseData` re-reads the file and parses frontmatter with `yaml` core schema (so unquoted ISO timestamps stay strings), then calls Astro's zod parse. `categories`: `glob('*.json', base ./src/content/categories, id = filename)`.
- Schema: `slug` (/^[A-Za-z0-9_-]+$/), `title`, `category` (slug), `description`, `draft` default **true**, `image` default `/media/default.webp`, `imageAlt/imageAttribution` default '', `imageWidth/imageHeight` int|null, `published/updated` = ISO-8601 datetime WITH offset coerced to Date (date-only or offset-less fails the build; verify-cms proves it), `author` default 'John Solly', `feedAuthor` default 'John_Solly', `excerpt` default '', `legacyId` optional, `related` slug[] default [].
- Identity/draft rules in `blogContent()`: throws on empty body/render, duplicate category slug, duplicate post slug, unknown category; drafts filtered; posts sorted by published desc; categories by name. `verify:identities` greps the message prefixes `Duplicate post slug:` / `Duplicate category slug:`.
- Fields used by code: author (JSON-LD), feedAuthor (Atom), excerpt (cards), imageAttribution (figcaption), image dims, updated (cards, feeds, sitemap lastmod), related (post page). `legacyId` is read by nothing; `legacyImage` and `legacyAuthorId` exist in all 106 frontmatters but are not in the schema (silently stripped). PagesCMS `.pages.yml` (not in this scope) keeps them as unmanaged data per astro-contract's CMS test.
- Stats [V]: 106 files, authors all John Solly, published 2021-12-28 .. 2025-11-28, categories web-dev 42 / productivity 25 / dev-tools 22 / resources 9 / Geodev 8 / uncategorized 0, 105 absolute hero image URLs + 1 `/media/default.webp` (the instant-pot post).
- Body stats [V]: 220 inline `style=` (47 files), 121 `<img>` (40 files) + 9 markdown images, 16 `<iframe>` (13 files; hosts: youtube.com 13, nbviewer.org 2, viewer.diagrams.net 1), 2 `<script>` mentions (sanitizer strips scripts), 0 fenced code blocks (code is raw `<pre><code>`), 64 `###` + 206 `##` + 10 `#` markdown headings.
- `related` graph: every post lists 2-3 slugs, all resolve. Posts referencing the instant-pot slug: UI-enhancement-leads-to-major-architecture-changes, compress-minify-assets-69-percent-faster-page-load, gis-job-search-resources. No post body links to the instant-pot URL. The instant-pot post itself is generated by `scripts/recipes/sync-recipe-article.mjs` (recipes:check) and hard-coded in 7 other files (see inventory entry).
- DST side: `src/content/` already holds `agent-pages.ts`, `socialLinks.ts` (plain modules, no collections, no `content.config.ts`). Coexistence is fine; use `src/content/blog/{posts,categories}`.

## 3. Routes ([F] src/pages)

| SRC route | Mechanism | Output | Proposed |
| --- | --- | --- | --- |
| `/` | index.astro, PostCards pageSize=3 (client `?page=N`, replaceState; no server pagination) | index.html | `/blog/` |
| `/post/[slug]/` | getStaticPaths over posts (106) | `post/<slug>/index.html` | `/blog/<slug>/` (no `/post/` segment) |
| `/category/[slug]/` | getStaticPaths over 6 categories, pageSize=3 | html | `/blog/category/<slug>/` |
| `/all-posts/` | all cards, SSR | html | `/blog/all-posts/` |
| `/search/` | noindex,follow island; `?searched=` read client-side | html | `/blog/search/` |
| `/search-index.json` | endpoint, 552,248 B uncompressed | json | `/blog/search-index.json` |
| `/rss/`, `/atom/` | endpoints | extensionless files `dist/rss`, `dist/atom` (Content-Type from vercel.json header rules for `/rss`,`/rss/`,`/atom`,`/atom/`) | `/blog/rss/`, `/blog/atom/` + same header rules |
| `/sitemap.xml` | hand-built (4 static + 6 categories + 106 posts with lastmod) | xml | drop; use DST `@astrojs/sitemap` (+`serialize` for lastmod; `filter` is REQUIRED for `/blog/search/`: proto sitemap-0.xml contains it, plus all-posts/privacy/works-cited) [V-proto] |
| `/robots.txt` | dynamic: Allow /, Disallow /search/, Sitemap | txt | drop; DST `public/robots.txt` + `Disallow: /blog/search/` |
| `/release.json` | `{sha}`; no-store header in vercel.json | json | drop under /blog; DST smoke takes the SHA from the GitHub deployment event (production-smoke.yml:32,38; production-smoke.mjs:6,32,63) and never fetches a release endpoint [V]; optional: ONE root /release.json for served-content proof |
| `/privacy/` | static | html | fold into DST `/privacy/` (decision) |
| `/works-cited/` | static | html | `/blog/works-cited/` (decision) |
| `/404` | noindex | 404.html | drop; DST has 404.astro |
| `/recipes/[slug]` (excluded) | imports Base layout | | recipes inventory |

Live check [V curl, 2026-10-04]: `/rss/`, `/atom/`, `/sitemap.xml`, `/robots.txt`, `/search-index.json`, `/release.json`, `/privacy/`, `/works-cited/`, `/search/`, `/all-posts/`, `/category/web-dev/`, `/pgp-key.txt`, `/.well-known/security.txt`, `/favicon.ico`, `/logo.webp`, `/topographic-logo.svg`, `/media/default.webp`, `/social/xLogo.svg` all 200; `/rss` 308 -> `/rss/`. (public/* are owned by another inventory but the post `security-txt-allows-researches-to-contact-you` links `/pgp-key.txt` and `/.well-known/security.txt`, and `how-to-send-email-with-python-the-hard-way` links `/password-reset/`.)

## 4. lib/*.ts specifics

- **html.ts heading fragment algorithm** [F src/lib/html.ts:61-75, [V] contract test]: after sanitizing, every `<h1>`..`<h3>` is rewritten so `id = headingId(plainText(innerHtml))`, `headingId(t)=t.trim().toLowerCase().replace(/\s+/gu,'-').replace(/[^a-zA-Z0-9_-]/gu,'')` (e.g. `A &amp; B: Example` -> `a--b-example`), and a `<a class="heading-link" href="#id" aria-label="Link to this heading">#</a>` is appended inside the heading. Any authored id on a heading is discarded; any non-heading element carrying an id that equals a generated heading id loses it; other authored ids and h4-h6 ids pass through unchanged (9 h4/h5 in `mastering-intuition-pumps-essential-terms-guide` have authored ids). No de-duplication suffix: duplicate ids exist today in 3 posts (geospatial-job-interview-tips `general-tips`, google-lighthouse-perfect-score `before`, my-favorite-youtube-channels-podcasts-newsletters `webdev`,`other`). The post page also renders `<h1 id=headingId(title)>` with the same link. Anchors in the wild (`/post/x/#general-tips`) must keep working => never change this algorithm during the move. DST's `process-html.mjs` slug (`/[\s.,?:]+/ -> '-'`, trim trailing '-', lowercase, keeps `&|'!` etc.) is a different algorithm that only applies to headings WITHOUT an id.
- **Sanitizer**: sanitize-html with allowlist (img/iframe/del/video/source added), schemes https/http/mailto, iframe hostnames (youtube, youtube-nocookie, viewer.diagrams.net, nbviewer.org) and 39 inline style properties; `img` gets `loading=lazy decoding=async` and `imageUrl()` rewriting; every `<a>` gets `rel="noopener noreferrer"`. The iframe host list and CSP `frame-src` must be edited together.
- **imageUrl** [F html.ts:6-10]: '' or `default.webp` -> `/media/default.webp`; `https://…` or `/media/…` unchanged; else `https://d1d7p8ufhgz4ld.cloudfront.net/media/` + path (strip leading `mediafiles/`).
- **content.ts** exports hard-coded `site = 'https://www.blogthedata.com'` used by feeds, sitemap.xml.ts, robots.txt.ts, post page (canonical, JSON-LD `mainEntityOfPage`, share URLs), Base.astro (canonical, og:url, og:image).
- **search.ts**: MiniSearch, boosts title 8 / description 3 / text 1, AND, prefix >=2, fuzzy 0.25 (>=5 chars) / 0.2 (4 chars); `search.test.mjs` pins the ranking.
- **cards.ts**: minutes = ceil(words/238); excerpt sanitized with articleHtml.

## 5. Base.astro ([F] src/layouts/Base.astro:15-50)

- Head: `<title>{title} | Blogthedata</title>`, description default 'Articles about geospatial development…', canonical `new URL(pathname, site)`, favicon `/favicon.ico`, RSS/Atom `<link rel=alternate>` to `/rss/` `/atom/`, og:title/description/url/type (article|website)/image(+alt), `twitter:card` only (no twitter:image/title), `noindex, follow` when set, `<noscript><link rel=stylesheet href=no-script.css?url>`, `<slot name="head">`.
- NO inline `<script>` or `<style>` in the layout (JSON-LD `application/ld+json` is emitted by the post page; the post page's `<script>` is bundled/hashed by Astro). No analytics. Fonts via `@fontsource/inter` 400/600 and `poppins` 600/700 (all subsets; DST imports only `latin.css` single-weight).
- Body: skip link, header (logo `/topographic-logo.svg` + Navigation island `client:load`), `<main id=main>`, footer nav (Home, All posts, Privacy, Works cited, RSS, Atom, Back to top), "Designed & built by John Solly".
- Imports 6 stylesheets (theme, recipes-theme, ui, global, article-content, motion), all unlayered global CSS.

## 6. UI components and styles vs DST

- DST ui: only `src/lib/components/ui/button.svelte` (flat) + `src/lib/ui-types.ts` (WithElementRef) + `src/lib/utils.ts` (cn). SRC ui: button, input (needed by blog), checkbox, collapsible(3), dialog(10), native-select(3), popover(8) + 5 `index.ts` barrels (recipes-only except button/input).
- `diff` of button.svelte [V]: class lists identical; DST adds biome-ignore noSecrets comments, import order, `href ,`; WithElementRef imported from `ui-types.js` in DST vs `utils.js` in SRC. SRC `utils.ts` additionally exports `WithElementRef` and `WithoutChildrenOrChild`; DST `cn` identical.
- Importers of ui components outside ui/: Navigation + Search -> button, input; recipes (not in scope) -> checkbox x3, collapsible x1, dialog x2, native-select x3, popover x2, button x5. Import specifiers differ: Navigation/Search use relative `../lib/components/ui/button/button.svelte`; recipes use `$lib/components/ui/<name>/<name>.svelte`.
- `components.json` identical in style (nova, neutral, lucide, same aliases) except tailwind css path (SRC `src/styles/ui.css`, DST `src/styles/main.css`).
- `tsconfig` `$lib`/`$lib/*` paths identical. DST adds fleet strict flags and `@astrojs/ts-plugin`.
- CSS: DST = Tailwind 4 full import (`main.css` -> tailwindcss + shadcn-svelte/tailwind.css + theme/ui/base/components/utilities, all in `@layer`), `@theme` palette `--color-*`. SRC = hand-written global CSS (unlayered) + `ui.css` that imports only theme+utilities (no preflight) with `@source` globs and an `@theme inline` map to blog vars (`--background, --text, --button, --hover, --border…`). Collisions if both load on one page: `--shadow-soft` (both define, different values), `--color-primary`/`--color-ring` values, global `h1/h2/p/a/button/input/body`, `:root{font-size:17px}`. [V-proto]: Astro bundles CSS per page entry — DST pages load only `Layout.*.css`, blog pages only `BlogBase.*.css` + no-script css — so a standalone `BlogLayout` isolates the two sites with zero CSS changes; sharing DST's `Layout.astro` would not.
- Tailwind utility classes in blog Svelte islands exist only through shadcn Button/Input (`@source "../lib/components/ui"`, Navigation, Search).

## 7. Hard-coded URL patterns (src, excluding recipes) [V git grep]

- `blogthedata`: `src/lib/content.ts:5` (site const), `src/lib/feeds.ts:11-12` (feed title/description), `works-cited` (logo credit); `migration-receipt.json` out of scope.
- Root-relative: `/post/` (PostCards x2, feeds, post page, privacy page link, sitemap, article-content.css x4), `/category/` (Navigation, PostCards, post page x2, sitemap), `/media/` (About, content.config default, Base default, html.ts x3), `/all-posts/` (Navigation, PostCards noscript, Search x2, Base footer, 404, sitemap), `/search/` (Navigation form, Search form, robots.txt.ts), `/search-index.json` (Search), `/rss/` (Navigation, Base x2), `/atom/` (Base x2), `/recipes…` (Base 1, post page 3), `/social/*` (About x4, post page share x3), `/topographic-logo.svg`, `/favicon.ico`, `https://github.com/jsolly/awesome-blog` (Navigation; repo will be archived).
- Post bodies/frontmatter: 138 `blogthedata.com` mentions in 43 files; 63 are links (57 `/post/<slug>/` in 31 files, 32 distinct targets, all exist; `/robots.txt` x1, `/password-reset/` x2, `/all-posts/` x1, `/pgp-key.txt` x1, bare root x1); prose-only: `/admin`, `/doesnotexist`, `/productivity?page1|2`, `/sitemap.xml`, `/.well-known/security.txt`, `/category/site-updates/`; `/media/` appears 178 times in bodies (43 files) = 108 `cloudfront.net/media/` image URLs (99 `<img>` + 9 markdown) + 68 `/media/recipes/…` (instant-pot post only) + 2 prose mentions (`/media/uploads`, `/media/meta_imgs`); frontmatter adds 105 more cloudfront hero URLs (213 cloudfront URLs repo-wide in posts); 3 `/search/` mentions are Google-doc links (not site links). No `/rss/`, `/atom/` in bodies. Cover `image:` values: 105 `https://d1d7p8ufhgz4ld.cloudfront.net/media/...`, 1 `/media/default.webp`.
- Redirect-relevant: two `redirects` in SRC vercel.json (`sollys-favorite-youtube-channels-and-podcasts` -> `my-favorite-youtube-channels-podcasts-newsletters`; `how-to-leverage-closed-loops` -> `stop-asking-questions-to-save-time`) must be collapsed to one hop to the final `/blog/<slug>/`. [F vercel.json]

## 8. astro.config.mjs -> astro.config.ts merge matrix

| Key | SRC | DST today | Action |
| --- | --- | --- | --- |
| site | https://www.blogthedata.com | NODE_ENV dev ? localhost : https://www.jsolly.com | keep DST; stop hard-coding site in lib |
| output | static | (default static) | none |
| trailingSlash | always | (default ignore; vercel.json trailingSlash:true) | add `always` [V-proto build ok] |
| prerenderConflictBehavior | error | (default) | add `error` (slug vs static-route guard) |
| integrations | svelte(), recipePwa() | svelte(), sitemap({customPages}) | keep DST; recipePwa -> recipes inventory; sitemap needs `filter`/`serialize` |
| vite plugins | tailwindcss() | tailwindcss() | same |
| markdown | satteri({features:{smartPunctuation:false,gfm:false}}), syntaxHighlight 'prism' | none (Shiki default) | add; `@astrojs/markdown-satteri` must become a direct dep (DST has it transitive 0.4.1; SRC pins 0.4.2) |
| csp.directives | default-src 'self', img-src 'self' https: data:, font-src 'self', connect-src 'self', object-src 'none', base-uri 'self', form-action 'self', frame-src (4 hosts) | default-src 'self' only | merge; prefer `img-src 'self' data: https://d1d7p8ufhgz4ld.cloudfront.net` |
| csp.styleDirective | element 'self' + attribute 'unsafe-inline' | resources ['self','unsafe-inline'] | adopt SRC's |
| server | host 127.0.0.1 port 4321 | none | drop |

Header CSP in DST `vercel.json`: `img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (no `default-src`/`script-src`, enforced by `built-csp.test.mjs`). Blog's SRC header is only `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`. Plan: update `img-src` in vercel.json; add `headers` for `/blog/rss`, `/blog/rss/`, `/blog/atom`, `/blog/atom/` (application/rss+xml / application/atom+xml, charset=utf-8); keep the no-script stylesheet first-party.

## 9. package.json dependency table

| Package (SRC version) | Needed after merge? | In DST? | Knip / notes |
| --- | --- | --- | --- |
| astro 7.3.5 (dep) | yes | `~7.3.2` devDep, lock 7.3.2 | bump to >=7.3.5 (blog tested there); keep DST's devDep placement |
| @astrojs/svelte 9.0.1 | yes | 9.0.1 | same |
| svelte 5.57.1 | yes | 5.57.1 | same |
| tailwindcss 4.3.3 / @tailwindcss/vite 4.3.3 | yes | ^4.3.3 | same |
| @astrojs/markdown-satteri 0.4.2 | yes (astro config) | transitive 0.4.1 only | add direct (Knip unlisted / Biome noUndeclaredDependencies) |
| @fontsource/inter, poppins 5.3.0 | yes (blog layout imports 400/600, 600/700) | ^5.3.0 devDeps | same pkgs; both `latin.css` and weight css resolve |
| clsx 2.1.1, tailwind-merge 3.6.0, shadcn-svelte 1.3.0 | yes | same versions | none |
| tailwind-variants 3.3.1 (dev) | yes (button) | 3.3.1 dep | none |
| sanitize-html 2.18.0 + @types/sanitize-html 2.16.2 | yes | no | add; Knip clean in proto |
| entities 8.1.0 | yes (html.ts) | no | add |
| minisearch 7.2.0 | yes (client search) | no | add |
| zod 4.6.5 | yes (Search.svelte, search.ts) | transitive 4.5.4 via astro | add direct; note config uses `astro/zod`; two zod copies possible |
| yaml 2.9.1 (dev) | yes (post-loader/frontmatter at build) -> should be a dependency | transitive 2.8.3 + override `>=2.8.3` | EOVERRIDE: change override to `"$yaml"` (verified) |
| @astrojs/check 0.9.10 | yes | 0.9.10 | same |
| svelte-check 4.7.6 (dev) | yes (only typechecker for .svelte) | no | add; chain into check:ts |
| playwright 1.63.0 (dev) | yes (browse.test, smoke) | 1.63.0 | same; chromium-1243 cached on this machine |
| cheerio 1.2.0 (dev) | yes while astro-contract/verify-cms parse HTML/XML; used by import/migration scripts and recipes pwa-build | no | add as devDep; Knip entry already includes scripts/**/*.mjs |
| markdownlint-cli2 0.23.3 (dev) | yes | ^0.23.2 | same; DST lock 0.23.2 |
| typescript 6.0.3 | yes | same | none |
| @types/node 26.6.4 (dev) | no (Node engine is 24.x; DST gets @types/node 24.12.2 transitively and `astro check` passed on `release.json.ts`-style node imports) | transitive | do not carry |
| turndown 7.2.4 + @types/turndown 5.0.6 (dev) | only for `scripts/html-to-markdown.mjs` <- `import-legacy.mjs` (one-time Django export importer; another inventory decides) | no | drop with import-legacy |
| @internationalized/date ^3.12.4 (dev) | only as bits-ui peer (`bits-ui` peerDependencies `@internationalized/date ^3.8.1`), i.e. only if recipes UI ports | no | git grep finds no other use; list only if bits-ui is added |
| bits-ui 2.19.5, @lucide/svelte 1.51.0 | only for recipes UI (checkbox, collapsible, dialog, popover, native-select) | no | recipes inventory |

DST-only deps that stay: biome 2.5.14, knip, jsdom, globby, html-minifier-terser, sharp, @astrojs/sitemap, @astrojs/ts-plugin, @vercel/edge, vercel. `package-lock.json` is regenerated. `allowScripts` esbuild pin differs (0.28.2 vs 0.28.1): lock resolves one.

## 10. Test/gate coverage map (what must still pass after the port)

- `scripts/astro-contract.test.mjs`: parsePost timestamps, articleHtml/plainText/headingId, redirects vs vercel.json, CSP hashes + header, publishedPaths exist, drafts omitted from index/sitemap/archive, CMS fields, feeds identity + MIME header rules, related cards, recipe route, release.json. It reads `dist/**` (index, rss, atom, sitemap.xml, all-posts, search-index.json, release.json) so paths/outputs need rewriting for `/blog/**`; it cannot run in DST's `npm test` (strip-types, `src/lib/*.test.ts` glob) unless wired; and several asserts (sitemap.xml, release.json, redirects.json) are for files that are being dropped.
- `scripts/search.test.mjs`: imports `src/lib/search.ts` (pure).
- `scripts/browse.test.mjs`: Playwright over built `dist`; adapted copy passes against the proto (`/blog/` paths) with DST's process-html applied. [V-proto]
- `verify:cms|drafts|identities`: mutate `src/content/posts`, run `npm run build` several times (each DST build also runs process-html + built-csp). Slow; path constants must move to `src/content/blog/posts` and `categories`.
- Instant-pot post: dispositioned `drop` in the JSON only in the sense of 'leaves the blog collection'; its content is re-homed at /recipes (target string says so). Its no-JS article body currently feeds blog search-index, RSS and sitemap; /recipes needs an equivalent crawlable/no-JS surface.
- `scripts/production-smoke-scenario.mjs` (SRC) hard-codes `www.blogthedata.com`, `/post/…`, `/all-posts/`, `/search/`, `/rss`, release.json and redirects.json; DST has its own smoke contract with a pinned URL.
- DST `built-csp.test.mjs`: passes on the proto (scripts only); does not cover styles/img/frame.

## 11. Cross-inventory flags (not my files, found while tracing)

- `scripts/recipes/pwa-build.mjs` pins `recipeRoute = '/post/15-minute-dump-and-go-instant-pot-recipes/'`; SRC vercel.json sets `Cache-Control: no-cache` on `/post/15-minute…/service-worker.js`; built output has `recipe-service-worker.js`, `recipes-pwa/`, `data/` at the root. A root-scoped service worker would control all of jsolly.com; also `worker-src`/manifest need CSP review. The Accept middleware skips `.js/.json/.webmanifest` by extension so those are safe.
- DST places blog links in 6 files (Footer, SiteNavigation, SiteIntro, agent-pages.ts x3, socialLinks.ts + blogthedataLogo.svg, public/llms.txt x3) that currently point to https://www.blogthedata.com and say "writing lives on Blogthedata, not here"; StructuredData `sameAs` derives from socialLinks.
- Blog `About.astro` copy says "Enterprise Health Division" while DST says "Health-IT Division": reconcile.
- DST nav label 'Blog' opens in a new tab with `rel=noopener` because it was external.

## 12. UNVERIFIED

- Vercel redirect `source` case-sensitivity for the 22 mixed-case slugs and `/category/Geodev/` (a redirects test must cover them).
- Whether Svelte hydration visibly flashes (CLS) after process-html strips markers; only functional parity (browse test) was run.
- Production behavior of Content-Type for extensionless `/blog/rss/` behind DST middleware + `vercel.json` header rules (blog's live behavior with the same rules is verified; DST's middleware layer is not deployed with it yet).
- Search Console / Bing property setup for blogthedata.com and any Change-of-Address (outside the repo).
- Browser rendering fidelity of the blog under DST (no visual diff was run; only DOM/CSP/test-level checks).
- Whether `npm run check:md` in DST CI is the only markdown gate affecting the 106 posts (verified with markdownlint-cli2 directly, not through `lint-md.sh`/gate).
