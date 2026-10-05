# Integration spike: awesome-blog transplanted into jsolly-website

Throwaway, scratch clones only: `clones/spike/{src,dst}` (SRC = awesome-blog bf1f7ff1, DST = jsolly-website 5694e76, branch `spike/merge-transplant`). Nothing touched the real checkouts. Raw logs in `clones/spike/logs/`; the transplant is reproducible with `logs/transplant.sh` plus the hand edits listed under "Deviations". Not run, not green by design: one full gate pass plus targeted measurements.

## 0. Headline findings (what the plan must absorb)

1. **Vercel header CSP blocks the legacy images.** DST `vercel.json` sends `img-src 'self' data:`. Chromium (playwright against `astro preview`, with the header injected) blocked the CloudFront images on `/blog/` (3 blocked) and a sample post (4 blocked). 112 of 146 built pages reference `https://d1d7p8ufhgz4ld.cloudfront.net` (318 distinct image URLs). The header must be loosened or the images moved first-party.
2. **Astro CSP is site-wide, not per page.** There is one meta policy on all 146 pages. Putting `img-src https:` and the `frame-src` list (youtube, youtube-nocookie, diagrams.net, nbviewer) into `astro.config.ts` loosens every portfolio page. Per-page insertion (`Astro.csp.insertDirective`) is UNVERIFIED here but the obvious alternative.
3. **Middleware breaks strict-Accept feed clients and `.md` assets.** `middleware.ts` content negotiation (`agentResponse`) was exercised as a unit call (15 cases, `logs/middleware-negotiation.txt`), not through Vercel routing. `GET /blog/rss/` with `Accept: application/rss+xml` -> **406**; `/blog/atom/` with `application/atom+xml` -> **406**; `application/xml, text/xml` -> 406. Clients that send `*/*`, no Accept header, or a list containing `*/*` pass through (e.g. `application/rss+xml, application/xml;q=0.9, */*;q=0.1` passes). `GET /recipes/data/recipe-library.md` -> **Markdown 404** (the `.md` suffix rule shadows the static file regardless of Accept). `Accept: text/markdown` on any `/blog/*` or `/recipes/` -> Markdown 404 because `agent-pages.ts` has no entries for them. The middleware needs a path exclusion or `config.matcher`, or agent-pages entries.
4. **Service worker scope.** `recipe-pwa-client.mjs` registers a worker with `scope: '/'`. Moved to `/recipes/service-worker.js` Chromium rejects it: "path of the provided scope ('/') is not under the max scope allowed ('/recipes/')". Left at the site root it would span all of jsolly.com. `pwa-build.mjs` also emits `dist/recipe-service-worker.js` at the root. Needs scope `/recipes/` (and a decision on the root worker).
5. **`process-html.mjs` defeats Svelte hydration on every island (verified).** SRC dist: 141/141 pages contain Svelte's `<!--[-->` markers; DST dist after `process-html`: 0/146 (`removeComments: true`). Islands report hydrated (no `astro-island[ssr]` left, nav toggle enabled, no console errors), but a node-identity probe (keep references to every SSR element inside `astro-island` at `DOMContentLoaded`, count how many are still connected after `networkidle`) shows **SRC reuses 77/77 (`/`), 5019/5019 (`/recipes/meals/`), 38/39 (search)** while **DST reuses 0/77 (`/blog/`), 0/5019 (`/recipes/meals/`), 0/39 (search), and 0/16 on the pre-existing `/about/` nav island**: every island is discarded and client-rendered. Attribution by variant (same build, only the post-process changed): no `process-html` -> full reuse (77/77, 5019/5019, 16/16); jsdom round-trip only -> full reuse; comments stripped, no whitespace collapse -> 0 reused; comments protected (`ignoreCustomComments: [/^\[/u, /^\]/u, /^$/u]`) **plus** `collapseWhitespace: true` -> 0 reused (markers present in all 146 pages, still no reuse); comments protected and **no** `collapseWhitespace` -> full reuse, and `built-csp.test.mjs` still passes. So the plan needs a `process-html.mjs` change (protect markers and stop whitespace collapse in island markup, or skip island subtrees); this is a latent defect on jsolly-website today (its nav island) and gets 5019-node blast radius on `/recipes/`. (The first probe I ran counted removals via `closest()` on detached nodes and was invalid; this identity probe replaces it. Raw: `logs/pw-hydration-identity.json`.)
6. **`.markdownlint.json` in `src/content/posts/` is load-bearing.** With it: 0 issues in 110 md files. Without it: 423 violations (MD009 191, MD036 155, MD010 50, MD034 8, MD026 8, MD012 3, MD051 2, MD011 2, MD001 2, MD037 1, MD024 1). Biome formats that JSON file (the only post-dir file it touches); Biome never touches the `.md` posts (0 of 106 bytes changed by `biome check --write`).
7. **`pwa.test.mjs` depends on awesome-blog git history.** It runs `git archive d6adba53e272964cc8c8e9583281dd1f35d8cc98` and builds that old release as the "previous shipped snapshot". That SHA is absent in DST (`git cat-file` fails). The `before()` hook fails for the whole file, so all 13 PWA/e2e cases cannot run in jsolly-website without importing history or being rewritten/dropped. The scenario (installed PWA on a different origin) changes anyway after cutover.
8. **Biome is the big cost: 1258 diagnostics (1152 errors + 106 warnings) in 113 files** on ported code; `biome check --write` clears only 281 (868 errors + 109 warnings remain). `--write` also reformats the generated `public/recipes/data/recipe-library.json`, which would break `recipes:check`; generated files need a Biome ignore.
9. **Build, CSP hash test, markdownlint, yamllint, smoke contract, svelte-check all pass; type check has only 2 errors.** `npm run build` with `process-html.mjs` and `built-csp.test.mjs` passes on all 146 pages (script hashes still match after minification). Heading ids: 0 existing ids changed, 16 ids added to previously id-less `h2`s in the 4 sampled posts. 24 additional pages (recipes) end up with duplicate ids (e.g. `cooking-flow` x15).
10. **Ported suites are not wired to DST's runner.** `npm test` only globs `src/lib/*.test.ts` (18 tests). Ported suites run standalone with `node --test`: 8/14 astro-contract, 3/3 search, 0/2 browse, 42/55 recipes pass unchanged-after-mechanical-rewrite; every failure is path/route/environment, none logic.
11. **Dependency conflict.** DST `overrides.yaml: ">=2.8.3"` makes `npm i -D yaml@2.9.1` fail with `EOVERRIDE`; the direct dependency had to be a range.
12. **Localstorage origin change.** `RecipeLibrary.svelte` stores `blogthedata-recipes-v2` in localStorage: per-origin, cannot migrate from blogthedata.com to jsolly.com (saved state is lost at cutover; installed PWAs keep serving the old origin).

13. **The mechanical rewrite corrupted legacy-path data files.** `rewrite.mjs` scanned all of `src/content`: `redirects.json` (redirect sources AND destinations: `/post/...` -> `/blog/...`) and `migration-receipt.json` (106 `publishedPaths` entries plus `categoryPaths`) changed; `intentional-rewrites.json` did not. Those hold **old-origin paths** and are the seed of the URL map, so they must be excluded from path rewrites (or kept as a frozen data file). This also explains part of the `test:astro` "historical redirects" failure (the test compares them to `vercel.json`). The `redirects.json` content itself has two entries; the vercel.json rules for them live in SRC `vercel.json`.
14. **Broken redirect target in SRC.** `/post/how-to-leverage-closed-loops/` redirects (SRC `vercel.json`, `redirects.json`) to `/post/stop-asking-questions-to-save-time/`, and **no such article exists** (`src/content/posts` and `dist/post` have no `stop-asking*`; SRC's own smoke notes the "closed-loop alias already targets a missing article"). That is why the fifth heading-id sample was skipped. The URL map must not build a 301 to a 404 for it; decide a real destination (`/blog/` or a relevant post) for John.
15. **Extra indexed URLs outside `/post`.** `public/.well-known/security.txt` (Contact `john@blogthedata.com`, Encryption and Canonical `https://www.blogthedata.com/...`, expires 2027-10-02) and `public/pgp-key.txt` exist on blogthedata.com and were never scanned by the rewrite; DST has neither. They need URL-map entries (`/.well-known/security.txt`, `/pgp-key.txt`) and their blogthedata.com values reviewed. Also `public/logo.webp`, `public/topographic-logo.svg`, `public/favicon.ico`, `public/social/*.svg` are first-party assets with their own URLs.

## 1. Baselines

### SRC (awesome-blog) in scratch clone

| Step | Result |
|---|---|
| `npm run build` | pass, 141 pages built (141 HTML, 265 files in dist), ~4.7 s |
| `npm run test:astro` | 14/14 pass |
| `npm run test:search` | 3/3 pass |
| `npm run test:browse` | 2/2 pass |
| `npm run test:recipes` | 55/55 pass |
| `npm run recipes:check` | pass |
| `npm run check:app` (astro check + svelte-check) | 0 errors, 1281 files |
| `verify:cms`, `verify:drafts`, `verify:identities` | pass |
| `verify:migration` | not runnable: requires `<authoritative-dumpdata.json>` (private export); one-time migration artifact |

### DST (jsolly-website) in scratch clone

| Step | Result |
|---|---|
| `biome ci . --error-on-warnings` | pass, 56 files |
| `check:yaml` (uvx 1.38.0) | pass |
| `check:knip` | pass |
| `check:md` | pass, 3 files |
| `smoke:scenario-contract` | pass, 1 test |
| `check:ts` | pass, 26 files, 0 errors |
| `npm test` | pass, 18 tests |
| `npm run build` (+process-html, built-csp) | pass, 7 HTML pages |

## 2. Transplant (provisional layout) and deviations

Layout used: `src/content/{posts,categories}` + `content.config.ts`; `src/lib/blog/*.ts`; `src/components/blog/` (About, Navigation, PostCards, Search); `src/components/recipes/`; `src/layouts/BlogLayout.astro` (from Base.astro); `src/styles/blog/`; `src/pages/blog/{index,[slug],category/[slug],all-posts,search,works-cited,rss,atom,search-index.json}`; `src/pages/recipes/{index,[slug]}`; `scripts/recipes/`; ported `scripts/*` (tests, verify-*, import/migration helpers); `public/blog/media`, `public/recipes/{data,pwa}`; shadcn `checkbox collapsible dialog input native-select popover` into `src/lib/components/ui/`.

Mechanical URL rewrite (node script, `logs/rewrite.mjs`), 642 replacements over 195 text files:

| Pattern | Replacements | Files |
|---|---|---|
| `/media/` -> `/blog/media/` | 328 | 13 |
| `/post/` -> `/blog/` | 187 | 37 |
| absolute `https://(www.)blogthedata.com` URLs -> `https://www.jsolly.com` (+path map) | 85 | 37 |
| `/all-posts|/search|/works-cited|/rss|/atom` -> `/blog/...` | 14 | 5 |
| `/category/` -> `/blog/category/` | 12 | 5 |
| `/data/recipe-library` -> `/recipes/data/recipe-library` | 7 | 2 |
| `/recipes-pwa/` -> `/recipes/pwa/` | 4 | 3 |
| `/post/15-minute-dump-and-go-instant-pot-recipes` -> `/recipes/` | 3 | 3 |
| `/recipe-service-worker.js` -> `/recipes/service-worker.js` | 1 | 1 |
| `/topographic-logo.svg` -> `/blog/topographic-logo.svg` | 1 | 1 |

Other mechanical work: 59 relative import specifiers rewritten in 28 files (`logs/fix-imports.mjs`); 12 shadcn `WithElementRef`/`WithoutChildrenOrChild` imports split to `$lib/ui-types.js`.

Things the regex rewrite **missed** (template literals, `${root}` paths, `fetch('/search-index.json')`, `href="/"`), each found only by running something:
- `${site}/post/...` and `${site}/${kind}/` in `feeds.ts` and the post page (5 spots)
- `Search.svelte` `fetch('/search-index.json')` (404 at runtime; found by playwright)
- `pwa-build.mjs`: `${root}/media/recipes`, `${root}/recipes-pwa`, and the page-listing `readdir('dist/recipes')` that treats `data/` and `pwa/` as pages (build crashed with ENOENT until excluded)
- `href="/"` brand/footer/breadcrumb/Navigation (5 edits)
- `dist/...` paths in 6 ported scripts (verify-*, contract tests)

Hand edits: `astro.config.ts` merged, `svelte.config.js` copied (DST had none), `package.json` (+7 deps, +8 devDeps, +9 scripts), SRC shadcn `button/` not copied (DST has flat `ui/button.svelte`; 3 import sites repointed), `src/pages/recipes/index.astro` created, `/blog/[slug]` filters the recipe post slug.

Not transplanted (collisions or out of scope for the spike): SRC pages `404`, `privacy`, `robots.txt.ts`, `sitemap.xml.ts`, `release.json.ts`; SRC `vercel.json`, `production-smoke*`, CI, pre-commit, AGENTS.md, `aws/*`, infra scripts+tests, docs.

## 3. Post-transplant gate pass (DST gate steps)

| Step | Baseline | After | Fix class |
|---|---|---|---|
| biome ci | pass | **FAIL: 1152 errors, 106 warnings, 113 files** | see below |
| yaml | pass | pass | n/a |
| knip | pass | **FAIL: 15 unused files, 4 unused exports** | mechanical to moderate |
| markdown lint | pass (3 files) | pass (110 files) **only with `posts/.markdownlint.json`** | n/a (keep config) |
| smoke scenario | pass | pass | n/a |
| check:ts (astro check) | pass, 0 | **FAIL: 2 errors** (`ts(4111)` in `src/lib/blog/html.ts:57,58`) | mechanical |
| svelte-check (SRC check:app second half) | n/a | 2 errors (same two), 1 warning (`baseUrl` deprecation in DST tsconfig) | mechanical |
| npm test | pass 18 | pass 18 (ported tests not included) | wiring needed |
| build + process-html + built-csp | pass, 7 pages | pass, **146 pages** (~8.6 s vs ~4.7 s SRC) | n/a |

### a) Biome (1258 diagnostics, 113 files)

By rule (top): `nursery/useLayeredStyles` 428, `performance/useTopLevelRegex` 140, `complexity/noImportantStyles` 99 (warnings), `nursery/useUnicodeRegex` 95, `format` 72, `nursery/useConsistentTestIt` 70, `assist/organizeImports` 68, `suspicious/noMisplacedAssertion` 49, `performance/noAwaitInLoops` 31, `style/useTemplate` 31, `suspicious/noShadow` 22, `nursery/noConditionalExpect` 17, `nursery/useNamedCaptureGroup` 17, `correctness/useImportExtensions` 16, `nursery/useDomNodeTextContent` 16, `a11y/noLabelWithoutControl` 12, `security/noSecrets` 11, `a11y/useAnchorContent` 8, remaining ~25 rules with 1-6 each.

By area: `src/components/recipes` 560, `src/styles/blog` 223, `scripts/recipes/pwa.test.mjs` 99, `src/lib/blog` 66, `scripts/astro-contract.test.mjs` 63, `scripts/verify-migration.mjs` 28, `scripts/recipes/article-generator.mjs` 24, `src/pages/blog` 24, `src/lib/components` 19, `src/components/blog` 12, rest in scripts.

Representative: `src/components/recipes/RecipeLibrary.svelte:51` (`noInvalidUseBeforeDeclaration` x5), `src/components/recipes/RecipeFlow.svelte` (37 `useLayeredStyles`), `src/styles/blog/global.css` (128 `useLayeredStyles`, plus `noDescendingSpecificity`), `scripts/astro-contract.test.mjs:129` (`noConditionalExpect`/`noAwaitInLoops`), `src/components/blog/About.astro:8-11` (`useAnchorContent` x8), `src/components/recipes/FilterMultiSelect.svelte:19` (`noLabelWithoutControl`).

`biome check --write --error-on-warnings` (on a scratch copy): changed 109 files; remaining 868 errors + 109 warnings. Auto-fixed: `format` 72, `organizeImports` 68, `useUnicodeRegex` 94, `useImportExtensions` 16, 24 `useConsistentTestIt`, and others. **Not fixed** (semantic/moderate): `useLayeredStyles` 428 and `noImportantStyles` 99 (CSS needs `@layer` wrapping and cascade review; this interacts with Tailwind 4 layers), `useTopLevelRegex` 140 (hoisting regexes), test-shape rules (`noMisplacedAssertion` 49, `useConsistentTestIt` 46, `noConditionalExpect` 17, `noAwaitInLoops` 31), a11y rules in recipe Svelte (`noLabelWithoutControl` 12, `useAriaPropsSupportedByRole` 4, `useAnchorContent` 8), `noShadow` 22. The relaxation alternative (a Biome override scoped to ported dirs) is a plan decision, not measured here. Biome also lints `.svelte` files (experimental) which SRC never did.

Side effects of `--write`: reformats generated `public/recipes/data/recipe-library.json` and `pwa/manifest.webmanifest` (breaks `recipes:check`); would reformat `src/content/posts/.markdownlint.json`; leaves 0 of 106 `.md` posts changed (Biome has no markdown formatter).

### b) Knip

Unused files (15), all generated shadcn: `checkbox/index.ts`, `collapsible/index.ts`, `dialog/{index.ts,dialog-close,dialog-footer,dialog-header,dialog-trigger}.svelte`, `native-select/{index.ts,native-select-opt-group,native-select-option}.svelte`, `popover/{index.ts,popover-close,popover-description,popover-header,popover-title}.svelte`. Unused exports (4): `dailyNutrients` (`recipes/nutrition.mjs:3`), `recipeDisclaimer` (`recipes/recipe-export.mjs:6`), `feedPosts` (`lib/blog/feeds.ts:4`), `legacyMedia` (`lib/blog/html.ts:4`). No unused dependencies, no config hints. Because DST knip treats `scripts/**/*.mjs` as entries, ported scripts do not appear as unused even if no npm script calls them.

### c) markdownlint on posts

0 issues / 110 files with the existing `.markdownlint.json` (disables MD001, 009, 010, 011, 012, 024, 026, 034, 036, 037, 040, 051 plus the root's 013/033/041). Without it 423 issues (see headline 6). Root `.markdownlint-cli2.jsonc` in the two repos is equivalent apart from DST not ignoring `.venv`.

### d) astro check / svelte-check

2 errors, both `ts(4111)` noPropertyAccessFromIndexSignature (`src/lib/blog/html.ts:57` `attrs.src`, `:58` `attrs.title`), from DST's stricter `strict-astro.json` (exactOptionalPropertyTypes, noUncheckedIndexedAccess, noPropertyAccessFromIndexSignature, verbatimModuleSyntax...). Svelte components in `recipes/` and the shadcn files type-check clean. Mechanical.

### e) Build, process-html, CSP hashes

- Build succeeds (146 pages) once `pwa-build.mjs` excludes `data/` and `pwa/` from its page enumeration (first attempt crashed: `ENOENT dist//recipes/data/index.html`).
- `built-csp.test.mjs` passes for all 146 pages: every inline script's sha256 is in the meta `script-src` after minification, and none allows `'unsafe-inline'`/`'unsafe-eval'`. Blog and recipe pages included.
- Heading ids (5-post sample, 4 had data: `Exploring-the-STAC-APIs...`, `adding-global-search`, `gis-job-search-resources`, `12-questions-you-should-ask...`): 16 headings unchanged, **0 changed, 0 removed, 16 added** (all previously id-less `h2`: the "Related posts" heading and the related-card titles). Generated ids can contain `&`, e.g. `easy-meals-&-smoothies`. Because `articleHtml()` already ids h1-h3, existing anchors survive.
- Duplicate ids: SRC 3/141 pages; DST 27/146. 24 extra, all on recipes pages (`/recipes/` has `cooking-flow` x15, `ingredients` x15, `before-you-start` x15, `cook` x15) from `process-html` slugging repeated Svelte-rendered headings.
- `process-html.mjs` `removeComments: true` strips all Svelte hydration markers (see headline 5).

### f) CSP (static analysis of built HTML + Chromium with and without the Vercel header)

Single meta CSP on all 146 pages: `default-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://viewer.diagrams.net https://nbviewer.org; script-src 'self' <9 hashes>; style-src 'self' 'unsafe-inline'`. DST header (unchanged): `img-src 'self' data:; style-src ...; font-src 'self'; base-uri; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests`. Browser enforces the intersection.

| Resource | Meta CSP | Vercel header CSP | Evidence |
|---|---|---|---|
| CloudFront https images (112 pages, 318 URLs) | allowed | **BLOCKED** | Chromium: "violates ... img-src 'self' data:" on `/blog/` (3) and a post (4) |
| iframes: youtube.com (10 pages), nbviewer.org (2), viewer.diagrams.net (1) | allowed by `frame-src` | no `frame-src`/`default-src` in header, so header does not block | static; not exercised in browser (UNVERIFIED) |
| `<link rel=manifest>` `/recipes/pwa/manifest.webmanifest` | `default-src 'self'` ok | ok | static |
| service worker | `default-src` -> `worker-src` falls back to `script-src 'self'`: ok | ok | scope error above is separate |
| inline `style=` attrs (61 pages) | `'unsafe-inline'` required: ok because DST `styleDirective` form kept; SRC used split element/attribute directives (stricter) | ok | static |
| `data:` URIs | allowed | allowed | static |
| form-action | `'self'` | n/a | `/blog/search/` is a GET form to self |

Also: the meta CSP is identical for the original DST pages, so the widened `img-src https:`/`frame-src` apply to about/contact/privacy/terms/home too (headline 2). With no header injected, Chromium reports zero CSP violations on blog/recipe pages.

### g) Ported test suites under DST (run directly with `node --test`, DST `npm test` does not pick them up)

| Suite | After mechanical rewrite | Failures and why |
|---|---|---|
| `test:search` | 3/3 | none |
| `test:astro` | 8/14 | recipe route moved to `dist/recipes/`; `dist/sitemap.xml` absent (DST uses `@astrojs/sitemap`: `sitemap-index.xml`/`sitemap-0.xml`); `dist/release.json` absent; RSS MIME-type assertion reads `vercel.json` headers (not ported); redirects-vs-vercel-rules assertion; related-cards test hits the old recipe post path. All path/config. |
| `test:browse` | 0/2 | `.menu-toggle` null: tests load `/` (now the portfolio home); need `/blog/` base and the blog nav |
| `test:recipes` | 42/55 | 13 PWA/e2e cases fail: fixture builds assume root `data/recipe-library.json`, `recipe-service-worker.js`, legacy `git archive d6adba53...` |
| `recipes:check` | pass after fixing 2 trailing-slash `new URL()` paths (tooling artifact of my rewrite) | none |
| `verify:cms/drafts/identities` | pass | none |
| `verify:migration` | not runnable | needs private dumpdata argument |

Tests run on SRC's un-minified `dist`; DST tests would run on `process-html`-minified output (spike ran them post-`npm run build`, so this was exercised: no minification-specific failures seen).

### h) Route collisions and sitemap

- `prerenderConflictBehavior: 'error'` raised nothing: no post slug collides with `blog/{category,search,rss,atom,all-posts,works-cited}` or recipe ids with `recipes/{data,pwa,meals,smoothies}` (slugs are mixed case, e.g. `Achieve-consistent-builds-with-Python-constraints`).
- Real collisions to resolve: `privacy` (SRC page vs DST page; blogthedata `/privacy/` should map to jsolly `/privacy/`), `404`/`500` (single root 404; DST noindexes), `robots.txt` (DST static; SRC endpoint had `Disallow: /search/`, needs `/blog/search/`), `sitemap.xml` (SRC custom endpoint vs DST sitemap index), `release.json` (SRC endpoint used by its smoke test), `production-smoke-scenario.mjs` / `production-smoke.mjs` (same filenames, different content), `.github/workflows/*`, `.git-hooks/pre-commit`, `.markdownlint-cli2.jsonc`, `components.json` (SRC tailwind css `src/styles/ui.css` vs DST `src/styles/main.css`), `src/lib/utils.ts`, CSS theme token names (SRC `--background/--text/...` on `:root` vs DST Tailwind `@theme` `--color-*`; SRC `ui.css` layer ordering `theme, base, components, utilities`).
- Generated sitemap (`@astrojs/sitemap`): 145 URLs: 115 under `/blog/`, 24 under `/recipes/`, 5 others. Includes **`/blog/search/` which is noindex**; needs a `filter`. SRC sitemap had 116 URLs. Feeds (`/blog/rss`, `/blog/atom`) and `search-index.json` are endpoints, not in the sitemap. Built output has `dist/blog/rss` and `dist/blog/atom` as extensionless files; `astro preview` served `/blog/rss/` with an empty `Content-Type`, so the four `vercel.json` header rules (`/rss`, `/rss/`, `/atom`, `/atom/` in SRC) must be ported with `/blog` prefixes.
- Existing DST content that must change when the blog moves in: links to `https://www.blogthedata.com/` in `public/llms.txt` (3 lines), `Footer.astro:11`, `SiteNavigation.svelte:12`, `SiteIntro.astro:52,55` ("writing lives on Blogthedata, not here"), `src/content/agent-pages.ts:62,94,111`, `src/content/socialLinks.ts:2,47-50`, `src/images/social/blogthedataLogo.svg`.

## 4. Other measured points

- Dist size 16 MB (DST after) vs 13 MB (SRC); `public/media` 5.1 MB, 45 media files.
- Page count: SRC 141 HTML; DST after 146 HTML (7 original + blog index/all-posts/search/works-cited + 6 categories + 105 posts + recipes index/meals/smoothies/ids; SRC `/privacy`, `/404` dropped; SRC post of the recipe page becomes `/recipes/`).
- `.pages.yml` (PagesCMS) and `verify-cms.mjs` copied unchanged: `.pages.yml` passes yamllint -s; its `media.output: /media` and `input: public/media` still point at old paths (not updated in spike; needs `/blog/media` and `public/blog/media`).
- Heavy runtime coupling to origin in `RecipeLibrary.svelte` (localStorage key `blogthedata-recipes-v2`) and in the PWA manifest `scope: '/'` (`pwa.test.mjs:100`).

## 5. Side effects and housekeeping

- I ran `pkill -f "astro preview"` twice (machine-wide pattern, not just my two previews); `pgrep -fl "astro preview"` afterwards showed nothing, but any other astro preview on this machine would have been killed too. Preview servers were mine (ports 4331/4332).
- `logs/process-html.orig.mjs` is the pristine copy; the clone's `process-html.mjs` is byte-identical to the original again and `dist` was rebuilt with the original (`npm run build`, exit 0) after the experiments.
- Probe scripts: `logs/.spike-pw.mjs` (CSP/console), `.spike-pw3.mjs` (hydration identity), `.spike-csp.mjs`, `.spike-ids.mjs`, `.spike-mw.test.ts`, `.spike-ph.mjs`.

## 6. UNVERIFIED / not measured

- Whether the `process-html.mjs` fix (protect markers, no whitespace collapse) is the right long-term shape vs skipping island subtrees; only the three variants above were run.
- Iframe embeds in a real browser under the combined CSP.
- `Astro.csp.insertDirective` per-page widening (docs not consulted here).
- `/rss` Content-Type on Vercel (only preview checked).
- Behavior of an already-installed blogthedata.com PWA after the origin goes redirect-only (code reading only: `pwa-build.mjs` fetch handler serves `ROUTE` navigations from cache, so redirects may never reach installed clients; a SW script that 404s/redirects cannot be updated). Needs its own investigation.
- `verify:migration` (needs private export).
- Any stricter Biome config options such as scoped overrides; only default DST config measured.
