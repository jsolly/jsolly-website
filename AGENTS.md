## Ship

Ship profile: `vercel-static`

**Integration: branch → PR → merge on green `CI / ci`.** `/ship` merges per `skills/ship/references/git-discipline.md` → Merge a same-repo self PR (read the installed `/ship` reference). Agents never push to `main`, change rulesets, or admin-merge.

Production URL: <https://www.jsolly.com>

Production verification follows Vercel READY and the public navigation, blog, recipe and Markdown behavior smoke. `/release.json` records the build SHA; smoke rejects stale or malformed live release identity before scenario interactions.

Local gate before push: `npm run gate`.

## Purpose

Personal website at [jsolly.com](https://www.jsolly.com), one Astro static site with three parts:

- **Portfolio:** the content pages `index`, `about`, `contact`, `privacy` and `terms`, each with a Markdown variant for agents, plus the `404` and `500` error pages, which have none.
- **Blog** under `/blog/`: posts and categories edited with PagesCMS (`docs/publishing.md`), with search and RSS and Atom feeds.
- **Recipes** under `/recipes/`: a recipe library that is also an offline app (`docs/recipes.md`).

The blog and recipes are moving here from blogthedata.com (repository `jsolly/awesome-blog`) under the merge plan in `docs/plans/blogthedata-merge/` (decisions J1–J28, cutover steps C0–C4). From cutover step C2 the old hosts are the redirect-only project in `legacy/blogthedata/` and redirect here. The plan bundle stays until its step D1.

## Stack

Astro 7 with Svelte 5 islands, TypeScript and Node pinned in `.nvmrc`; Tailwind CSS 4 (via `@tailwindcss/vite`) and shadcn-svelte parts on bits-ui; Biome 2 for lint and format; `@astrojs/sitemap`; Inter and Poppins via `@fontsource`. The blog renders Markdown with the satteri processor and Prism, sanitizes article HTML with `sanitize-html` and searches with MiniSearch. Tests use `node:test`, jsdom and Playwright (Chromium). Vercel hosts the static output plus `middleware.ts`; PagesCMS edits the blog content.

## Frontend stack

Astro owns static pages; Svelte + shadcn-svelte owns interactive product UI.
Use the installed generated controls for new or replaced standard controls,
loading `/shadcn-svelte`. Navigation uses a hydrated Svelte island and the
hero/contact calls to action use server-rendered Button anchors. Preserve
native link semantics, first-party assets, the portfolio palette and focus.
`components.json` configures the pinned local CLI and existing Tailwind styles.
Reuse `src/lib/components/ui`; import defining component files directly.

The blog and recipe ports keep some awesome-blog native controls for parity with live blogthedata.com under the approved merge plan (J25), until the post-C4 visual unification follow-up: the `<details>` categories menu and the toggle/inert mobile disclosure, which work without JavaScript through `no-script.css`; the post cards' "Load more posts" link, which `no-script.css` hides so the noscript archive link is the way on; and the post page's "Print this post" button, share links, "Back to home" link and heading-link copy script.

New blog and recipe controls use shadcn-svelte. The recipe pages already use shadcn-svelte's bits-ui parts (`dialog*`, `collapsible*`, `checkbox`, `native-select`, `popover*` in `src/lib/components/ui/`). Native `<details>`, checkboxes and a share link are the server-rendered no-JavaScript fallback. The recipe library's controls need JavaScript; without it, `recipes-no-script.css` leaves only the collection links and the cards, whose links open each recipe's page.

Canon: `~/code/dotagents/rules/frontend-stack.md`.

## Dependencies / Assets

**No CDN for app assets.** Runtime CSS/JS (and app fonts) come from npm, local files, or same-origin build output. Do not load jsDelivr, unpkg, cdnjs, or similar CDNs at runtime.

## Commands

```bash
npm run dev                 # Astro dev server (localhost:4321)
npm run build               # astro build (writes the route manifest) + node process-html.mjs + recipe service worker (scripts/recipes/pwa-build.mjs) + built-CSP test (csp suite)
npm run build:maintenance   # MAINTENANCE_MODE=true npm run build (renders Maintenance.astro)
npm run preview             # Preview the production build locally
npm run gate                # the full pre-commit gate (see CI below)
npm run check:fix           # biome check --write
npm run check:ts            # astro check + svelte-check (errors only)
npm run fix                 # check:fix + check:ts (combined)
npm test                    # unit tests: src/**/*.test.{ts,mjs} and scripts/unit/*.test.mjs
npm run test:built          # built-output tests: scripts/built/*.test.mjs against dist/ (run after build)
npm run smoke:scenario-contract  # the production smoke scenario's contract tests (smoke suite)
npm run smoke:production    # the production smoke itself, against the pinned production URL
npm run redirects:write     # regenerate legacy/blogthedata/vercel.json from url-map.json
npm run redirects:check     # fail when legacy/blogthedata/vercel.json differs from what url-map.json generates
npm run recipes:sync        # regenerate public/recipes/data/recipe-library.{json,md} from recipes.json
npm run recipes:check       # fail when public/recipes/data differs from what recipes.json generates
```

## Tests

Every suite runs through `scripts/run-tests.mjs`: `unit` (`npm test`: `src/**/*.test.{ts,mjs}` and `scripts/unit/*.test.mjs`), `built` (`npm run test:built`: `scripts/built/*.test.mjs`), `csp` (the end of `npm run build`: `scripts/built-csp.test.mjs`) and `smoke` (`npm run smoke:scenario-contract`: `scripts/production-smoke-scenario.test.mjs`). It fails a suite when its passing-test count differs from `scripts/test-counts.json`. Update the count in the commit that adds tests; lower it only in a commit that names each dropped test.

- Built tests read `dist/` through `scripts/built/pages.mjs` (shared readers, a static server, and stand-ins for every off-origin request, the CloudFront post images and embed frames included). No test reaches the network.
- A built test that needs its own build uses a `scripts/built/temp-copy.mjs` copy of the working tree, never the real tree; that file's header describes the isolation.
- Browser tests wait for `!document.querySelector("astro-island[ssr]")` before interacting.
- Expectations come from the post frontmatter, `recipes.json` and `legacy/blogthedata/url-map.json`, never from the code under test.

This is the one inventory of the test files. The unit `release-identity` contract checks Vercel/GitHub SHA precedence, Git HEAD fallback and malformed build-SHA rejection.

- **Unit, `scripts/unit/`:**
  - `run-tests` pins the runner and its ledger.
  - `tailwind-sources` and `process-html-ids` pin the Tailwind sources and the heading-id exclusion (Conventions, Invariants).
  - `vercel-csp-header` pins the CSP header's directive map; `vercel-headers` routes the feeds' Content-Types and the recipe worker's `no-cache` through Vercel's routing-utils.
  - `site-files` and `blogthedata-redirects` run the security.txt check on both hosts and pin the shared `Expires`. `blogthedata-redirects` also compiles the legacy `vercel.json` with `@vercel/routing-utils` and routes every row form and known path through it, including the ledger of paths served today that deliberately become 404 (J27), whose only home is that test's constants.
  - `recipe-data` checks that every recipe image is an existing `/recipes/media/` file, holds the PWA manifest to `PWA_NAME` and `PWA_THEME_COLOR`, pins the Markdown library's heading structure and the 15 meals and 6 smoothies ("every recipe is a meal or a smoothie: 15 meals and 6 smoothies"), and checks that the drift check reports edited and missing downloads.
  - `verify-blogthedata-cutover` and `verify-blogthedata-transports` run the cutover verifier against local stubs and a fake `vercel` CLI only.
- **Unit, beside the code:** `src/lib/blog/*.test.ts` (loader, schemas, cards, html, feeds, search; `html.test.ts` "Every post renders with unique ids, no executable markup and all its h2 and h3 headings" pins 105 post files; `pages-config.test.ts` pins `.pages.yml` to the collections and schemas and runs `biome ci` on a category saved the PagesCMS way), `src/components/recipes/*.test.mjs` (the pure recipe modules), `src/lib/accept-negotiate.test.ts`, and `src/content/constants.test.ts`, which holds `public/llms.txt` to the shared wording.
- **Built, blog:**
  - `blog-browse`: home, archive and category pages.
  - `blog-contract`: every published legacy post and category URL and the related cards.
  - `blog-post`: heading-link copy and Print.
  - `blog-search`: search, and a failed index.
  - `blog-feeds`: the feeds and their legacy ids (J8).
  - `blog-site-files`: the sitemap against the pages' robots meta and post frontmatter, robots.txt, and that the URLs the site files name are built.
  - `blog-content-contracts`: posts saved the PagesCMS way, built in a temp copy. Timestamps, preformatted text and `/blog/media` uploads survive, a draft reaches no built file or route, and bad timestamps, duplicate slugs and unknown `related` slugs fail the build.
  - `blog-maintenance`: a `MAINTENANCE_MODE` build takes every page offline and ships no recipe worker.
  - `blog-css-sources`: fails when a blog `@source` path is missing, a blog or recipes stylesheet lacks the shared `@layer` statement, or the BlogLayout bundle loses a pinned selector or loads the portfolio stylesheet.
- **Built, recipes:**
  - `recipe-page` and `recipes-built`: recipe pages with and without JavaScript, and the built routes without it.
  - `recipes-browse`: recipe pages and share links, the filters and their saved settings, the collection pages without JavaScript, and the nutrition help's focus.
  - `recipes-library`: printing, the dialog's history, and saved settings that no longer fit or are malformed.
  - `recipes-deep-links`: every old `/recipes/#<recipe-id>` link and `#meal-results`, opened cold.
  - `recipes-pwa`: install, offline use, updates, failed downloads, a maintenance deploy, and hydration with service workers blocked.
- **Built, legacy host:** `blogthedata-killswitch` (both kill-switch workers in Chromium across two origins), `blogthedata-destinations` (every 301 destination is built) and `legacy-fragments` (each 301 destination keeps the old page's fragment ids once its route is built).
- **Built, site-wide:** `internal-links` (the link checks over the whole build, on the site model in `scripts/built/site-links.mjs`), `hydration` (islands hydrate in place after `process-html.mjs`), `route-manifest`, `noindex-pages` (404 and 500 name no URL of their own), `csp-browser` (Content Security Policy below), `release-identity` (the exact build SHA) and `production-smoke` (the smoke runner against the built site, GET only).

## Worktrees

`npm run worktree:init` runs `npm ci` in a fresh worktree. No `.worktreeinclude` is needed: the only gitignored source file, `src/generated/route-manifest.js`, is written by `npm run build`, and nothing before a build needs it. There is no gitignored runtime configuration or local state.

## Architecture

### Portfolio and shared code

- **`src/pages/`:** the portfolio pages render with `src/layouts/Layout.astro`.
- **`src/components/`:** `Header`, `Footer`, `ContactMe`, `SocialLinks`, `StructuredData`, `Maintenance`, the navigation island `SiteNavigation.svelte`, the index-page sections in `home/`, and the `blog/` and `recipes/` subdirs.
- **`src/content/`:** `constants.ts` (John's role and the site's self-description in the J18 wording, the blog and recipe descriptions, `siteLinks` for the navigation and footer, and `socialLinks`; it imports no assets, so the middleware and the navigation island can import it), `types.ts`, `agent-pages.ts` (the agent Markdown pages), and the blog collections in `blog/`, defined in `src/content.config.ts`.
- **`middleware.ts`:** Vercel routing middleware (every path; no matcher). The same URL serves HTML or Markdown by `Accept` (`src/lib/accept-negotiate.ts`, `src/lib/agent-response.ts`, pages in `src/content/agent-pages.ts`): the five portfolio content pages have Markdown variants and `.md` siblings, and any other path asked for as Markdown gets the Markdown 404 that `public/llms.txt` promises. Any path ending in a file extension other than `.md` is static and never negotiated or answered 406, and files under `/recipes/data/` are served as they are, `.md` included (an extensionless miss there keeps the Markdown 404). Real routes under `/blog/` and `/recipes/` serve HTML only (J11 in the merge plan), with no `Vary: Accept`; the percent-decoded path is looked up in the route manifest, and unknown paths there keep the Markdown 404.
- **Route manifest:** the `routeManifest` integration in `astro.config.ts` writes the gitignored `src/generated/route-manifest.js` from Astro's own `astro:build:done` page list (`export const routes = [...]`, one `/path/` per built page, `/` for the index, error pages excluded). `middleware.ts` imports it, and Vercel bundles the middleware after `npm run build`, so it ships that build's list. The tracked `route-manifest.d.ts` types the import, so `check:ts` and knip pass before any build. The lib functions take the route set as a parameter, so unit tests inject their own.
- **`process-html.mjs`:** runs after every `astro build`. It adds slugified `id` attributes to id-less `h2/h3/h4`, except under `dist/blog/` and `dist/recipes/`, and runs `html-minifier`. The minifier keeps the Svelte and Astro hydration comments and collapses whitespace conservatively, so islands hydrate in place instead of re-rendering; Svelte's `<!>` anchor that ends a `<select>` or `<option>` with snippet content, which the minifier cannot parse, is rewritten to the equivalent `<!---->` first.
- **`astro.config.ts`:** the site URL flips between `localhost:4321` (dev) and `https://www.jsolly.com` (prod). It sets `trailingSlash: "always"` and `prerenderConflictBehavior: "error"`, and renders Markdown with the satteri processor (`smartPunctuation` and `gfm` off) and Prism highlighting, because Shiki emits inline styles under the CSP. The `@astrojs/sitemap` options list every built page except the noindex `/blog/search/` (`filter`; the integration drops 404 and 500 itself; `/recipes/` pages are listed, J12) and give each post a `lastmod` from its frontmatter `updated` (`serialize`). The config reads those times once at load with `postLastmods` (`POSTS_DIR` and `POST_FILES` in `src/lib/blog/constants.ts`), because the integration swallows a throw inside `serialize` and the build would pass without a sitemap.
- **Site files:** `public/robots.txt` disallows only `/blog/search/`; the legacy host's `robots.txt` disallows nothing, so crawlers follow its 301s. Both hosts' `.well-known/security.txt` (Contact `https://www.jsolly.com/contact/`, J15) carry no `Encryption` (Invariants) and share one `Expires`, which must fall after HEAD's commit date and less than 365 days after it (in the pre-commit hook HEAD is the parent of the commit being made), so bump both together yearly. `scripts/site-files.mjs` holds the one parser, `Expires` reader and security.txt check; the cutover verifier reads the live files' `Expires` with the same reader.
- **`docs/`:** `publishing.md` (PagesCMS editing), `recipes.md` (recipe data, pipeline, offline app, kill-switch), `recipes-evidence/` (recipe provenance, J17: kept byte-for-byte, skipped by Biome and markdownlint, its `.py` an inert record) and `plans/` (archival planning records, the merge plan bundle in `docs/plans/blogthedata-merge/`; Biome and markdownlint ignore it, and Tailwind does not scan it).

### Blog

- **`src/layouts/BlogLayout.astro`:** standalone (no Markdown alternate). It honors `MAINTENANCE_MODE` (the notice replaces the body, and the page's head slot, its post JSON-LD and article meta included, is dropped). With `section="blog"` it adds the per-page `img-src` (CloudFront) and `frame-src` (YouTube, diagrams.net, nbviewer) CSP directives, failing the build when `Astro.csp` is unavailable. It imports the stylesheets in `src/styles/blog/` (`theme`, `ui`, `blog`, and `no-script` through `?url`).
- **Routes:** `/blog/`, `/blog/all-posts/`, `/blog/category/<slug>/` (slug case kept, e.g. `Geodev`; the `category/` folder is Astro's routing layout), `/blog/works-cited/`, and the noindex `/blog/search/`, whose `Search` island reads `?searched=` and fetches the `/blog/search-index.json` endpoint (one entry per published post). One page per published post, `/blog/<slug>/` (`blog/[slug].astro`, slug case kept), carries breadcrumbs, related cards, share links and BlogPosting JSON-LD on jsolly.com URLs. The `/blog/rss.xml` and `/blog/atom.xml` endpoints list the five most recently updated posts; BlogLayout links both as alternates, and `vercel.json` sends their Content-Types, which a static build cannot.
- **`src/components/blog/`:** `BlogNavigation` (the blog chrome), `PostCards` (the card list with its load-more island), `AuthorCard` (whose `h2#about-author` is a legacy fragment id) and `Search`.
- **`src/lib/blog/`:**
  - `post-loader.ts`: the PagesCMS frontmatter loader (YAML core schema), plus `postLastmods`, read at config load, so a bad post file fails the build there, named.
  - `schemas.ts`: the post and category schemas, plus `publishedContent` and `categoryCounts` (the pure checks, draft filter, orderings and category names). The build fails on an empty article, a duplicate post or category slug, an unknown category or a `related` slug naming no post.
  - `content.ts`: only the `getCollection` wiring (`blogContent`, `blogNavigation`).
  - `cards.ts`: `cards`, the pure post card data (UTC date labels, the same-day updated rule, reading time), and `dateLabel`.
  - `urls.ts`: `postHref` and `categoryHref`, slug case kept; dependency-free, so client islands can import them without the sanitizer.
  - `types.ts`: `Card`, `CardPost`, `FeedPost`, `LegacyRow`.
  - `html.ts`: the article sanitizer, heading ids, and `imageUrl`, which maps bare legacy upload paths onto `LEGACY_MEDIA`.
  - `feeds.ts`: the pure `rssFeed` and `atomFeed` builders, links on the Astro `site`, and `legacyFeedIds`, the pre-merge feed ids from `url-map.json` (J8).
  - `search.ts`: the search index parse and MiniSearch.
  - `constants.ts`: `POSTS_DIR`, `POST_FILES`, `CATEGORIES_DIR`, `DEFAULT_IMAGE`, `LEGACY_MEDIA`, `EMBED_HOSTS`, `FEEDS` (each feed's path, media type and alternate title), the feed title and description, `LEGACY_SITE` and `ATOM_FEED_ID`.
- **`.pages.yml`:** the PagesCMS config. Media uploads land in `public/blog/media` and are served at `/blog/media`; the posts and categories paths are `POSTS_DIR` and `CATEGORIES_DIR`.

### Recipes

The data, pipeline and offline app are documented in `docs/recipes.md`.

- **`src/layouts/RecipeLayout.astro`:** wraps BlogLayout `section="recipes"` for every recipe page with `recipes-theme.css`, the recipe app's head tags (manifest, theme colour, touch icon and app title; none in a maintenance build) and `RecipePwa` ahead of the page.
- **Routes:** one page per recipe, `/recipes/<id>/` (`recipes/[slug].astro`, ids from `recipes.json`), whose `RecipePage` island reads `?servings=` and `?starch=<id>:<side>` share links and whose section id is the recipe id, so old `#<id>` links land. The landing `/recipes/` (`recipes/index.astro`), where blogthedata.com's Easy Meals & Smoothies post will 301 from cutover step C2, renders the whole library, meals first, keeps the post's `#easy-meals--smoothies`, `#meal-results` and `#about-author` ids, and opens any `#<recipe-id>` in the library dialog. `/recipes/meals/` and `/recipes/smoothies/` (`recipes/meals.astro`, `recipes/smoothies.astro`) are `RecipeCollectionPage.astro`: the library opened on that collection.
- **Saved settings:** `{ servings, filters, appliancesOnHand, familyChoice }` (nothing else) in `localStorage` under `recipes-settings-v1` (J13).
- **`src/components/recipes/` data:** `recipes.json` (images under `/recipes/media/`, files in `public/recipes/media/`), `nutrition-data.json` (Daily Value nutrients and each recipe's per-ingredient rows), and `constants.mjs`: `BASE_SERVINGS`, `SERVING_CHOICES`, the disclaimer and leftovers text, the starch and appliance tables, the recipe paths `RECIPES_PATH` (`/recipes/`, also the app's scope), `PWA_WORKER_PATH` and `PWA_FILES_PATH`, the app's `PWA_NAME` and `PWA_THEME_COLOR`, and the library's `STORAGE_KEY`, `DEFAULT_FILTERS`, filter choices, nutrition thresholds and appliance limits.
- **Pure modules** (each with a `*.test.mjs`): `recipe-logic.mjs` (settings, scaling, quantity and temperature display, per-serving and smoothie nutrition, package notes), `display-units.mjs` (metric cooking text), `nutrition.mjs` (Daily Values and recorded omega-3), `nutrient-filters.mjs` (library filters and appliance inventory; `parseSavedSettings` validates every saved key, family sides against their recipe's sides), `trn-logic.mjs` (the Tabular Recipe Notation grid and its HTML), `recipe-export.mjs` (the cooking document behind print and the assistant downloads), `recipe-url.mjs` (share links and their parsing), `ingredient-icon.mjs` and `recipe-print-session.mjs` (the Print buttons' print step for both islands).
- **Components:** the page island `RecipePage.svelte`, `RecipeBody`, `RecipeFlow` (the TRN table and its method dialog), `RecipePrint` (the print-only copy), `ShareRecipe`, `ApplianceIcon` and `NutrientDisclosure`. The library is `RecipeExperience.astro` (the island and its no-JavaScript styles), `RecipeLibrary.svelte` (saved settings, filtering, the shuffled cards, the dialog's history and printing), `LibraryControls.svelte`, `RecipeCard.svelte`, `RecipeTakeover.svelte` (the full-screen recipe dialog), `RecipeBadge.svelte`, `FilterMultiSelect.svelte` and `NutritionHelp.svelte`.
- **Styles:** `src/styles/recipes/recipes-theme.css` (recipe colours and print rules, imported by recipe pages only). Its no-JavaScript companion, `recipes-no-script.css` (the `.recipe-experience` fallback rules, in the `blog-no-script` layer), is linked inside `<noscript>` by its only importer, `RecipeExperience.astro`.
- **Assistant data:** `scripts/recipes/sync-assistant-data.mjs` (`recipes:sync`, `recipes:check`) generates the committed downloads `public/recipes/data/recipe-library.{json,md}` from `recipes.json`; Biome and markdownlint skip them.
- **Offline app:** RecipeLayout links the manifest and icons in `public/recipes/pwa/` and renders `RecipePwa.astro`, whose `recipe-pwa-client.mjs` registers `/recipes/service-worker.js` with scope `/recipes/`. `scripts/recipes/pwa-build.mjs` writes that worker in `npm run build`, after process-html: the runtime source `scripts/recipes/service-worker.js` with the snapshot's cache name and precache list prepended, precaching every file under `dist/recipes/` and everything its pages load. A `MAINTENANCE_MODE` build writes none (BlogLayout then drops the head slot and the page body, so no page links the app); any other build whose landing page links no app manifest fails. `vercel.json` serves the worker `no-cache`.

### Legacy host (`legacy/blogthedata/`)

- **The project:** the redirect-only static project for the old blog hosts (blogthedata.com, `www.blogthedata.com`, `blogthedata.vercel.app`), owned by this repo. It is the Root Directory of the separate Vercel project `blogthedata` and stays inert until John re-points that project here at cutover step C2 (decisions J1, J2).
- **`url-map.json`** is the source of truth: each row of known old paths 301s to `https://www.jsolly.com/...`, serves a file from `public/`, or stays 404 (the static `public/404.html`; no catch-all). Rows of class `service-worker` also get the no-cache JavaScript headers. `meta.freeze_sha` records the awesome-blog source freeze SHA pinned at C0. jsolly.com's build reads it too, for the legacy feed ids (Invariants).
- **`url-union.json`** records every known old path, its evidence and whether it is served 200 today. **`vercel.json`** is generated (Invariants → edit flow).
- **`public/`** holds only `404.html`, `robots.txt`, `.well-known/security.txt` (the site files policy above) and the two kill-switch service workers.
- **`fragment-ids.json`:** the fragment ids each old page offered, generated from the frozen awesome-blog build at C0. The manifest records its source SHA; temporary generation tools are retired.
- **Cutover verifier:** `scripts/verify-blogthedata-cutover.mjs` checks the live hosts against `url-map.json` and `url-union.json` at cutover and daily after it (plan §4.10); its transports live in `scripts/verify-blogthedata-transports.mjs`. It is not part of the gate and imports the repo's own modules, so it needs `npm ci` first. Its header lists the modes (`--production`, `--production --sample`, `--base-url`, `--destinations-only --base-url`) and the `--transport fetch|vercel-curl` and `--bypass-env NAME` options (NAME holds the bypass secret, which is never printed). A `--base-url` must be https; http is allowed only for a loopback stub. Agents never run its `--transport vercel-curl` mode (John only).
- **Source freeze:** C0 retired the temporary import/generation tools and their tests. `url-map.json` and `fragment-ids.json` retain the frozen source SHA, also recorded in the migration plan. Historical tools remain in Git history; publishing continues through the destination workflow after cutover.

## Invariants

These hold for every change. Where a test enforces one, it is named; the rest are policy that review checks.

- **The heading-fragment algorithm is frozen.** Blog heading ids come from `headingId` in `src/lib/blog/html.ts`, the old blog's h1–h3 algorithm; old links and `legacy/blogthedata/fragment-ids.json` depend on its output. Do not change it, and keep a heading's text when its fragment must stay stable. Blog and recipe pages are excluded from `process-html.mjs`'s id pass (`scripts/unit/process-html-ids.test.mjs`). Recipe pages get no generated ids: on `/recipes/`, the h1's `#easy-meals--smoothies`, the card wrapper's `#meal-results` and the author card's `#about-author` are hand-written legacy-fragment ids from the old post (`scripts/built/legacy-fragments.test.mjs`); each recipe's section id (on its page and in the library dialog) is its recipe id; RecipeTakeover's `recipe-detail-title` exists only for `aria-labelledby`.
- **Slugs are case-sensitive and stable.** Post, category and recipe slugs are URLs that old redirects, feeds and links point at; never rename or re-case one. `scripts/built/internal-links.test.mjs` (c) checks that every link uses the exact case and that no two routes differ only in case. Its asserted counts (22 mixed-case posts and one mixed-case category, `Geodev`) freeze the migration contract: a changed count means the content changed, not that a link is wrong. Retire those two count assertions after cutover; keep the case checks.
- **PagesCMS owns its formats** (`docs/publishing.md`). `published` and `updated` are ISO 8601 strings with seconds and an explicit offset, string fields rather than date controls, parsed with the YAML core schema; date-only or offset-less values fail the build (`blog-content-contracts`). The body stays PagesCMS's Markdown code editor: no WYSIWYG editor without a verified complex-article roundtrip (tables, code, embeds); policy. `settings.content.merge: true` keeps unmanaged frontmatter (`legacyId`, `legacyImage`, `legacyAuthorId`). PagesCMS writes category JSON as `JSON.stringify(x, null, 2)` with no final newline, so `biome.jsonc` turns the formatter off for `src/content/blog/categories/**` only, linting kept on (`pages-config.test.ts`); never reformat those files.
- **CloudFront is a runtime dependency (J6).** Legacy post images load from the retained `blogthedata` S3 bucket through CloudFront `https://d1d7p8ufhgz4ld.cloudfront.net` (`LEGACY_MEDIA`). The bucket and distribution must outlive any AWS cleanup until those images are rehosted same-origin. The CSP allows exactly that host (Content Security Policy below).
- **Legacy feed ids (J8).** For posts that predate the merge (a `post` row in `url-map.json`), the RSS `<guid>` (with `isPermaLink="false"`) and the Atom entry `<id>` stay `https://www.blogthedata.com/post/<slug>/`, and the Atom feed id stays `https://www.blogthedata.com/atom/` (`ATOM_FEED_ID`). New posts get jsolly.com ids. Adding or removing a post row changes that post's feed id, and subscribers see it again as a new item (`scripts/built/blog-feeds.test.mjs`).
- **The kill-switch workers are never removed.** `legacy/blogthedata/public/recipe-service-worker.js` and `post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js` are byte-identical, retire the old cache-first recipe workers, and stay as long as the old host is served (`docs/recipes.md`). `scripts/built/blogthedata-killswitch.test.mjs` proves both work; keeping them is policy.
- **The `legacy/blogthedata` edit flow.** Edit `url-map.json` (and `url-union.json` when the edit adds a known path), run `npm run redirects:write`, and commit all three; the gate's `redirects:check` fails on drift.
- **No `Encryption` in security.txt** (policy, no check). `public/pgp-key.txt`, the old blog's key, expired on 2023-05-08 and stays only because the legacy `/pgp-key.txt` redirect (SEC-001) and two posts link to it. Re-add `Encryption` to both hosts' security.txt only after John publishes a current key.
- **The recipes pipeline.** `recipes.json` is the source: after editing it, run `npm run recipes:sync` and commit the regenerated `public/recipes/data/` with it (the gate's `recipes:check`). Never hand-edit or Biome-format the generated files.
- **bits-ui focus scope (2.19.5).** bits-ui re-runs a popover content's FocusScope once, a few milliseconds after it opens, and that unmount runs the close auto-focus, pulling focus back to the trigger while the popover stays open. `NutritionHelp.svelte`'s `restoreFocus` always prevents bits-ui's restore and focuses the trigger only when focus is inside the help (`recipes-browse.test.mjs`). `FilterMultiSelect.svelte` keeps bits-ui's default close auto-focus, so it is exposed to the same remount; no failure is known. Re-check both on any bits-ui bump.
- **Service workers blocked.** The production smoke's browser runs with Playwright's `serviceWorkers: "block"`, under which `register()` resolves with no registration; `recipe-pwa-client.mjs` then returns early and leaves the install instructions instead of logging a console error that would fail the smoke (`recipes-pwa.test.mjs` "Recipe library hydrates without errors when the browser blocks service workers").
- **Portfolio CSS is review-only pinned.** The portfolio's built `dist/_astro/Layout.*.css` has the baseline sha1 `39f7204ada8fa10a187bd8f5dd211f0e344bab2b` (45,705 B). No test checks it, because dependency bumps legitimately change the bytes. Blog and recipe work must leave it byte-identical; the reviewer checks the selector diff of any change, and an approved CSS change updates this baseline in the same PR.

## Deploy

Production deploy is owned by **Vercel's GitHub integration** — a merge to `main` triggers the Vercel build and deploy. There is no local `npm run deploy` or CLI deploy step from `/ship`. Branch pushes do **not** create Preview deployments (`vercel.json` `git.deploymentEnabled`).

**Opt-in Preview:** comment `/preview` as the first non-empty line on a same-repo PR (owner/member/collaborator User), or run workflow **Vercel Preview** with the PR number. GitHub runs that workflow from `main`. One-shot: new commits do not rebuild until you ask again. Requires GitHub secret `VERCEL_TOKEN`. Agents must not comment `/preview` unless the user asked.

If a green merge creates no Vercel deployment, verify that the project's Git connection uses the current GitHub repository ID. Recreating a repository under the same name can leave Vercel linked to the old ID. Reconnect the current repository through Vercel's Git settings; the repository name alone does not prove the connection is current.

`npm run build:maintenance` swaps in the maintenance page. To take the site offline temporarily, set `MAINTENANCE_MODE=true` in the Vercel project env (or redeploy from the Vercel dashboard with that env) — not via a local CLI deploy.

## CI (local pre-commit gate)

- `.git-hooks/pre-commit` runs through the installed dotagents hook dispatcher and validates Bash, Biome, YAML, Actions, Markdown, browser contract, Knip, the legacy redirect config (`redirects:check`), the generated recipe data (`recipes:check`), Astro and Svelte types (`check:ts`), unit tests, build and built-output tests. GitHub Actions repeats the gate on the PR; the hook does **not** deploy.

## Conventions

- **Tabs** for indentation (Biome default, also matches `biome.jsonc`).
- **Tailwind utilities** over custom CSS; theme tokens live in `src/styles/`.
- **Tailwind sources are explicit.** `src/styles/main.css` imports Tailwind with `source(none)` and lists its `@source` / `@source not` paths, so docs, data and blog or recipe code never change the portfolio bundle. Tailwind class strings must live in `src/components`, `src/layouts`, `src/pages` or `src/lib`. The blog paths (`lib/blog`, `components/blog`, `pages/blog`, `layouts/BlogLayout.astro`), the recipe paths (`components/recipes`, `pages/recipes`, `layouts/RecipeLayout.astro`) and the shadcn-svelte parts in `lib/components/ui` are excluded from the portfolio sources, with `ui/button.svelte` re-included because the portfolio uses it (`scripts/unit/tailwind-sources.test.mjs` asks Tailwind's own scanner). The blog and recipes have their own entry, `src/styles/blog/ui.css`, with its own `source(none)` and `@source` list (the ui parts and the blog navigation and search; recipe components use no Tailwind utilities of their own). Each page loads one entry stylesheet, portfolio or blog, never both (`scripts/built/blog-css-sources.test.mjs`; Tailwind ignores a missing `@source` path silently).
- **Blog stylesheets are layered.** Every blog and recipe stylesheet and every recipe component `<style>` block declares `@layer properties, theme, base, components, utilities, blog, blog-no-script;`. Ported rules sit in `blog` (or `blog-no-script`), declared last, so the relative cascade is unchanged.
- **Whitespace is lossless.** `astro.config.ts` sets `compressHTML: true`; Astro 7's default `"jsx"` drops line-break whitespace next to elements and glues prose to inline links and code. `scripts/built/inline-spacing.test.mjs` checks the rendered text of the portfolio pages.
- **Heading IDs are auto-generated** by `process-html.mjs` from heading text — don't hand-write `id="..."` on headings unless overriding the generated slug. Blog and recipe pages own their ids instead (Invariants → heading-fragment algorithm).
- **Code layout.** Pure logic lives in tested modules (`src/lib/blog/*.ts`, `src/components/recipes/*.mjs`), with types in `types.ts` and literals in `constants.ts`. `content.ts` is collection wiring only. Pages stay flat where Astro routing allows.

## Local UI verification

No auth — public UI only. Follow `rules/frontend-verification.md` (fleet smoke: desktop + mobile screenshots, console clean).

- **Dev server:** `npm run dev` → <http://localhost:4321>
- **Auth:** none — public pages only. No `DEFAULT_USER` / `DEFAULT_PASSWORD`.

## Production smoke

The **Production smoke** workflow is a separate post-deployment gate. It waits
for the intended production release and verifies the public browser flow with
`npm run smoke:production`. The URL is pinned in
`scripts/production-smoke-scenario.mjs`; the workflow uses no deployment secrets.
Vercel Git deployment and the existing PR CI checks remain unchanged.

The scenario is GET only, runs at a phone width with service workers blocked,
and lists its steps at the top of `scripts/production-smoke-scenario.mjs`. The
runner, `scripts/production-smoke.mjs`, is a fleet template copy and is never
edited here: change the scenario together with its `smoke` suite.
`scripts/built/production-smoke.test.mjs` runs it through the runner against
the built site, and fails if any request it makes is not a GET.

`/ship` must wait for the exact release's Production smoke run to succeed and
record its URL. Missing, failed, cancelled, skipped or timed-out runs are not
success. If the automatic trigger is missing, dispatch the workflow on `main`
with the full expected release SHA and a unique request ID, then follow that
specific run. Preserve `production-smoke-artifacts/` diagnostics when a check fails.

## Verified-tree CI

PRs run the full CI suite. Post-merge CI reuses a successful PR run only when
its recorded checkout tree exactly matches the landed tree, using
`scripts/ci-verified-tree.sh` from dotagents. Missing proof runs full CI;
manual runs always validate. Job names and deployment triggers stay intact.
Canonical contract: `~/code/dotagents/templates/github/verified-tree-ci.md`.

## Dependabot CI

Dependabot PR events allocate no validation runners until a manually invoked
`/optimize-workspaces drain` applies the `ow-ci` label. Only the `labeled`
event adding `ow-ci` runs the real `ci` check; later Dependabot pushes defer
again until a drain re-kicks the new head (remove, then re-add). Deferred runs
report `ci-deferred` and cannot satisfy the required `ci` check. Skipped or
absent checks never authorize a dependency merge. See the Dependabot CI kick in
the canonical `dotagents/skills/optimize-workspaces/references/pr-drain.md`.

## Git hooks

`core.hooksPath` is the dotagents dispatcher `~/.local/share/dotagents/hooks`, installed and set by the dotagents installers. Never point it at `.git-hooks` or set it from a package script. The dispatcher runs this repo’s tracked pre-commit hook only when its bytes match a version on `origin/main` or your approved hook blob. Approve only your own edits using the command printed by the refusal. Review fork and third-party PR heads using `gh pr diff`; never check them out here. Canon: dotagents `rules/agent-cloud-access.md` → GitHub.

## Fleet rollout

Changes inside this repo ship normally. For changes other repos must adopt, link the merged PR on the existing dotagents Todoist fleet-rollout task. Do not start that rollout or spawn per-repo chips, PRs or tasks from here. John authorizes one lead to walk the fleet after canon settles. Follow the installed `persist-todos-in-todoist` skill → Fleet rollout.

## Content Security Policy

Astro `security.csp` emits per-page hashes for the island bootstrap and owns
`default-src`/`script-src`. Vercel keeps the other resource restrictions and
`frame-ancestors` in its response header. Do not add a conflicting header
`script-src` or `default-src`, or allow arbitrary inline scripts. Verify built
pages with both policies; Astro dev/preview alone does not apply Vercel headers.

The header's `img-src` also allows `https://d1d7p8ufhgz4ld.cloudfront.net`,
the retained blogthedata S3/CloudFront host that serves legacy blog post images
(a runtime dependency, decision J6 in `docs/plans/blogthedata-merge/plan.md`), and `form-action 'self'`, which does not
fall back to `default-src`. Browsers enforce the intersection, so the Astro meta
still limits images on every page to `'self'` until a page adds its own
`img-src` directive; BlogLayout adds one, with that host, on `/blog/` pages only.
`scripts/csp.mjs` holds the one policy parser.
`scripts/unit/vercel-csp-header.test.mjs` pins the full header directive map,
and the build-time `csp` suite checks every built `<img>` and `<source srcset>` URL against both policies, and the blog pages' own directives.
`scripts/built/csp-browser.test.mjs` runs these pages in Chromium with the header served on every response, and fails on any `securitypolicyviolation`:

- `/blog/`, and posts with YouTube, nbviewer and diagrams.net embeds;
- a `/blog/search/?searched=django` search (the island parses its index with zod, whose JIT `search.ts` turns off);
- `/about/`;
- a recipe page, `/recipes/greek-turkey-patties/`, with its notation dialog opened (its island scripts and same-origin images, plus the bits-ui dialog's inline styles under `style-src 'unsafe-inline'`);
- `/recipes/meals/` with a filter and the nutrition help popovers opened;
- `/recipes/#lemon-salmon-and-asparagus` with the library's recipe dialog open.

On the recipe pages it also waits for the recipe service worker to control the page at scope `/recipes/`, and it checks that every other page has no service worker registered.

Astro lists every inline script hash of the build in each page's meta policy,
so an inline `<script>` on a blog page also adds its hash to the portfolio pages.
