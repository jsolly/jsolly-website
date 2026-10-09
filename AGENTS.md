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

The blog and recipes migrated from blogthedata.com. The [source repository](https://github.com/jsolly/awesome-blog) is archived. The old hosts run the redirect-only project in `legacy/blogthedata/`; permanent deployment, monitoring and recovery facts are in [docs/legacy-redirects.md](docs/legacy-redirects.md). The completed plan remains in Git history.

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

Portfolio, blog and recipes share `SiteShell.astro`, the portfolio header/footer
and semantic theme. Blog categories use the installed Collapsible and Button
parts, with expanded category links in the no-JavaScript render. Load-more,
article printing, share actions and back navigation use installed Button controls;
the heading-link copy script retains stable article fragments. Without JavaScript,
the archive link replaces load-more and the shared mobile navigation stays visible.

New blog and recipe controls use shadcn-svelte. The recipe pages already use shadcn-svelte's bits-ui parts (`dialog*`, `collapsible*`, `checkbox`, `native-select`, `popover*` in `src/lib/components/ui/`). Native `<details>`, checkboxes and a share link are the server-rendered no-JavaScript fallback. The recipe library's controls need JavaScript; without it, `recipes-no-script.css` leaves only the collection links and the cards, whose links open each recipe's page.

Canon: `~/code/dotagents/rules/frontend-stack.md`.

## Dependencies / Assets

**No CDN for app assets.** Runtime CSS/JS (and app fonts) come from npm, local files, or same-origin build output. Do not load jsDelivr, unpkg, cdnjs, or similar CDNs at runtime.

## Commands

```bash
npm run dev                 # Astro dev server (localhost:4321)
npm run build               # astro build (writes the route manifest) + node process-html.mjs + static Markdown siblings (scripts/markdown-build.mjs) + recipe service worker (scripts/recipes/pwa-build.mjs) + built-CSP test (csp suite)
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

Test discovery belongs to `scripts/run-tests.mjs`; suite counts belong only to `scripts/test-counts.json`. Read the test files for their current cases rather than copying titles or content counts into this guide.

- Unit tests live beside the pure modules in `src/` and under `scripts/unit/`.
- Built-output and browser tests live under `scripts/built/`. They cover portfolio, blog, recipes, maintenance, legacy redirects, links, fragments, hydration and release identity.
- CSP tests live in `scripts/built-csp.test.mjs` and `scripts/built/csp-browser.test.mjs`.
- Production scenario contracts live in `scripts/production-smoke-scenario.test.mjs`; the built-site smoke is `scripts/built/production-smoke.test.mjs`.

## Worktrees

`npm run worktree:init` runs `npm ci` in a fresh worktree. No `.worktreeinclude` is needed: the only gitignored source file, `src/generated/route-manifest.js`, is written by `npm run build`, and nothing before a build needs it. There is no gitignored runtime configuration or local state.

## Architecture

### Portfolio and shared code

- **`src/pages/`:** the portfolio pages render with `src/layouts/Layout.astro`.
- **`src/components/`:** `Header`, `Footer`, `ContactMe`, `SocialLinks`, `StructuredData`, `Maintenance`, the navigation island `SiteNavigation.svelte`, the index-page sections in `home/`, and the `blog/` and `recipes/` subdirs.
- **`src/content/`:** `constants.ts` (John's role and the site's self-description in the J18 wording, the blog and recipe descriptions, `siteLinks` for the navigation and footer, and `socialLinks`; it imports no assets, so the middleware and the navigation island can import it), `types.ts`, `agent-pages.ts` (the agent Markdown pages), and the blog collections in `blog/`, defined in `src/content.config.ts`.
- **`middleware.ts`:** Vercel routing middleware (every path; no matcher). Published portfolio, blog and recipe pages negotiate HTML or Markdown by `Accept`, with `Vary: Accept`. Portfolio bodies are inline; `scripts/markdown-build.mjs` converts actual published blog HTML and canonical recipe documents into static `.md` siblings. The edge manifest contains route/file pairs, never article bodies. Explicit `.md` requests serve Markdown regardless of `Accept`; unknown page paths retain the Markdown 404. Static files (other extensions, and all `/recipes/data/` files) are never negotiated or answered 406. Paths decode by segment and match case-sensitively. Recipe Markdown uses four servings in US measures and retains source uncertainty; browser query controls remain on HTML. Offline recipe snapshots cache the variants with explicit Accept keys, using the same negotiation helper as middleware. AWS image hosting remains retained.
- **Route manifest:** the `routeManifest` integration in `astro.config.ts` writes the gitignored `src/generated/route-manifest.js` from Astro's own `astro:build:done` page list (`export const routes = [...]`, one `/path/` per built page, `/` for the index, error pages excluded). `middleware.ts` imports it, and Vercel bundles the middleware after `npm run build`, so it ships that build's list. The tracked `route-manifest.d.ts` types the import, so `check:ts` and knip pass before any build. The lib functions take the route set as a parameter, so unit tests inject their own.
- **`process-html.mjs`:** runs after every `astro build`. It adds slugified `id` attributes to id-less `h2/h3/h4`, except under `dist/blog/` and `dist/recipes/`, and runs `html-minifier`. The minifier keeps the Svelte and Astro hydration comments and collapses whitespace conservatively, so islands hydrate in place instead of re-rendering; Svelte's `<!>` anchor that ends a `<select>` or `<option>` with snippet content, which the minifier cannot parse, is rewritten to the equivalent `<!---->` first.
- **`astro.config.ts`:** the site URL flips between `localhost:4321` (dev) and `https://www.jsolly.com` (prod). It sets `trailingSlash: "always"` and `prerenderConflictBehavior: "error"`, and renders Markdown with the satteri processor (`smartPunctuation` and `gfm` off) and Prism highlighting, because Shiki emits inline styles under the CSP. The `@astrojs/sitemap` options list every built page except the noindex `/blog/search/` (`filter`; the integration drops 404 and 500 itself; `/recipes/` pages are listed, J12) and give each post a `lastmod` from its frontmatter `updated` (`serialize`). The config reads those times once at load with `postLastmods` (`POSTS_DIR` and `POST_FILES` in `src/lib/blog/constants.ts`), because the integration swallows a throw inside `serialize` and the build would pass without a sitemap.
- **Site files:** `public/robots.txt` disallows only `/blog/search/`; the legacy host's `robots.txt` disallows nothing, so crawlers follow its 301s. Both hosts' `.well-known/security.txt` (Contact `https://www.jsolly.com/contact/`, J15) share one `Expires`, which must fall after HEAD's commit date and less than 365 days after it (in the pre-commit hook HEAD is the parent of the commit being made), so bump both together yearly. `scripts/site-files.mjs` holds the one parser, `Expires` reader and security.txt check; the cutover verifier reads the live files' `Expires` with the same reader.
- **`docs/`:** `publishing.md` (PagesCMS editing), `recipes.md` (recipe data, pipeline, settings and offline operations), `recipes-evidence/` (recipe provenance, J17: kept byte-for-byte, skipped by Biome and markdownlint, its `.py` an inert record) and `legacy-redirects.md` (legacy deployment, monitoring and recovery).

### Blog

- **`src/layouts/BlogLayout.astro`:** section metadata and CSP wrapper around the shared `SiteShell`, with a Markdown alternate for each published page outside maintenance mode. It honors `MAINTENANCE_MODE` (the notice replaces the body, and the page's head slot, its post JSON-LD and article meta included, is dropped). With `section="blog"` it adds the per-page `img-src` (CloudFront) and `frame-src` (YouTube, diagrams.net, nbviewer) CSP directives, failing the build when `Astro.csp` is unavailable. It imports scoped `src/styles/blog/blog.css` and the section's `no-script.css` through `?url`; `SiteShell` owns the shared main stylesheet.
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
  - `feeds.ts`: the pure `rssFeed` and `atomFeed` builders, links on the Astro `site`, and `legacyFeedIds`, whose compatibility rule is in Invariants.
  - `search.ts`: the search index parse and MiniSearch.
  - `constants.ts`: `POSTS_DIR`, `POST_FILES`, `CATEGORIES_DIR`, `DEFAULT_IMAGE`, `LEGACY_MEDIA`, `EMBED_HOSTS`, `FEEDS` (each feed's path, media type and alternate title), the feed title and description, `LEGACY_SITE` and `ATOM_FEED_ID`.
- **`.pages.yml`:** the PagesCMS config. Media uploads land in `public/blog/media` and are served at `/blog/media`; the posts and categories paths are `POSTS_DIR` and `CATEGORIES_DIR`.

### Recipes

Read [docs/recipes.md](docs/recipes.md) before changing recipe data, assistant downloads, settings or the offline app. It owns their formats, cooking and nutrition limitations, regeneration steps, install/update behavior and legacy-worker operations.

- `src/pages/recipes/` owns the landing, collection and individual recipe routes. `RecipeLayout.astro` supplies the recipe stylesheet and app head tags through BlogLayout.
- `src/components/recipes/` holds the canonical JSON, pure modules with adjacent tests, and Svelte controls. `RecipeExperience.astro` supplies the collection island and no-JavaScript fallback; `RecipePage.svelte` supplies individual pages; `RecipeTakeover.svelte` supplies the library dialog.
- `src/styles/recipes/` holds the recipe and no-JavaScript styles. `recipe-export.mjs` is the shared cooking document for printing and assistant downloads.
- `scripts/recipes/` holds assistant-data generation and the service-worker build. The manifest and icons are under `public/recipes/pwa/`; illustrations are under `public/recipes/media/`.

### Legacy host (`legacy/blogthedata/`)

- **The project:** the redirect-only static project for the old blog hosts (blogthedata.com, `www.blogthedata.com`, `blogthedata.vercel.app`), owned by this repo. It is the Root Directory of the separate Vercel project `blogthedata` and is live from protected `jsolly/jsolly-website` main. Auto-assign Custom Production Domains stays off through the soak; staged builds do not replace the proven domain deployment. See `docs/legacy-redirects.md` before changing or promoting it.
- **`url-map.json`** is the source of truth: each row of known old paths 301s to `https://www.jsolly.com/...`, serves a file from `public/`, or stays 404 (the static `public/404.html`; no catch-all). Rows of class `service-worker` also get the no-cache JavaScript headers. `meta.freeze_sha` records the awesome-blog source freeze SHA pinned at C0.
- **`url-union.json`** records every known old path, its evidence and whether it was served 200 in the frozen source. See Invariants for the redirect edit flow.
- **`public/`** holds only `404.html`, `robots.txt`, `.well-known/security.txt` (the site files policy above) and the two kill-switch service workers.
- **`fragment-ids.json`:** the fragment ids each old page offered, generated from the frozen awesome-blog build at C0. The manifest records its source SHA; temporary generation tools are retired.
- **Cutover verifier:** `scripts/verify-blogthedata-cutover.mjs` checks the live hosts against `url-map.json` and `url-union.json` at cutover and daily after it through `.github/workflows/legacy-redirects.yml`; its transports live in `scripts/verify-blogthedata-transports.mjs`. It is not part of the gate and imports the repo's own modules, so it needs `npm ci` first. Its header lists the modes (`--production`, `--production --sample`, `--base-url`, `--destinations-only --base-url`) and the `--transport fetch|vercel-curl` and `--bypass-env NAME` options (NAME holds the bypass secret, which is never printed). A `--base-url` must be https; http is allowed only for a loopback stub. Agents never run its `--transport vercel-curl` mode (John only).
- **Source freeze:** C0 retired the temporary import/generation tools and their tests. `url-map.json` and `fragment-ids.json` retain the frozen source SHA, also recorded in `docs/legacy-redirects.md`. Historical tools remain in Git history; publishing continues through the destination workflow after cutover.

## Invariants

These hold for every change. Where a test enforces one, it is named; the rest are policy that review checks.

- **The heading-fragment algorithm is frozen.** Blog heading ids come from `headingId` in `src/lib/blog/html.ts`, the old blog's h1–h3 algorithm; old links and `legacy/blogthedata/fragment-ids.json` depend on its output. Do not change it, and keep a heading's text when its fragment must stay stable. Blog and recipe pages are excluded from `process-html.mjs`'s id pass (`scripts/unit/process-html-ids.test.mjs`). Recipe pages get no generated ids: on `/recipes/`, the h1's `#easy-meals--smoothies`, the card wrapper's `#meal-results` and the author card's `#about-author` are hand-written legacy-fragment ids from the old post (`scripts/built/legacy-fragments.test.mjs`); each recipe's section id (on its page and in the library dialog) is its recipe id; RecipeTakeover's `recipe-detail-title` exists only for `aria-labelledby`.
- **Slugs are case-sensitive and stable.** Post, category and recipe slugs are URLs that old redirects, feeds and links point at; never rename or re-case one. `scripts/built/internal-links.test.mjs` (c) checks that every link uses the exact case and that no two routes differ only in case. The completed migration no longer freezes post or category counts; exact-case link checks remain.
- **PagesCMS owns its formats** (`docs/publishing.md`). `published` and `updated` are ISO 8601 strings with seconds and an explicit offset, string fields rather than date controls, parsed with the YAML core schema; date-only or offset-less values fail the build (`blog-content-contracts`). The body stays PagesCMS's Markdown code editor: no WYSIWYG editor without a verified complex-article roundtrip (tables, code, embeds); policy. `settings.content.merge: true` keeps unmanaged frontmatter (`legacyId`, `legacyImage`, `legacyAuthorId`). PagesCMS writes category JSON as `JSON.stringify(x, null, 2)` with no final newline, so `biome.jsonc` turns the formatter off for `src/content/blog/categories/**` only, linting kept on (`pages-config.test.ts`); never reformat those files.
- **CloudFront is a runtime dependency (J6).** Legacy post images load from the retained `blogthedata` S3 bucket through CloudFront `https://d1d7p8ufhgz4ld.cloudfront.net` (`LEGACY_MEDIA`). The bucket and distribution must outlive any AWS cleanup until those images are rehosted same-origin. The CSP allows exactly that host (Content Security Policy below).
- **Legacy feed ids (J8).** For posts that predate the merge (a `post` row in `url-map.json`), the RSS `<guid>` (with `isPermaLink="false"`) and the Atom entry `<id>` stay `https://www.blogthedata.com/post/<slug>/`, and the Atom feed id stays `https://www.blogthedata.com/atom/` (`ATOM_FEED_ID`). New posts get jsolly.com ids. Adding or removing a post row changes that post's feed id, and subscribers see it again as a new item (`scripts/built/blog-feeds.test.mjs`).
- **Retain the legacy kill-switch workers.** Keep both workers listed in [docs/recipes.md](docs/recipes.md) as long as the old host is served. `scripts/built/blogthedata-killswitch.test.mjs` verifies their behavior.
- **The `legacy/blogthedata` edit flow.** Edit `url-map.json` (and `url-union.json` when the edit adds a known path), run `npm run redirects:write`, and commit all three; the gate's `redirects:check` fails on drift.
- **No `Encryption` in security.txt** (policy, no check). `public/pgp-key.txt`, the old blog's key, expired on 2023-05-08 and stays only because the legacy `/pgp-key.txt` redirect (SEC-001) and two posts link to it. Re-add `Encryption` to both hosts' security.txt only after John publishes a current key.
- **Follow the recipe pipeline.** [docs/recipes.md](docs/recipes.md) owns the data and regeneration contract; treat its evidence directory as an inert record.
- **Popover focus.** `NutritionHelp.svelte` and `FilterMultiSelect.svelte` suppress unconditional close auto-focus and restore the trigger only when focus remains inside their panel. Both are nonmodal, so an outside control keeps focus and Tab can move on. Multi-choice filters focus the first enabled button synchronously on opening; queued autofocus must not reclaim focus after Tab. The `recipes-browse` suite covers keyboard and pointer dismissal; re-check both on any bits-ui bump.
- **Service workers blocked.** The production smoke's browser runs with Playwright's `serviceWorkers: "block"`, under which `register()` resolves with no registration; `recipe-pwa-client.mjs` then returns early and leaves the install instructions instead of logging a console error. The `recipes-pwa` tests cover this case.
- **Shared stylesheet ownership.** Portfolio, blog and recipes use the shared shell and `src/styles/main.css` theme/UI entry. Blog and recipe sheets retain scoped content and cooking/print rules. The former isolated portfolio bundle checksum is retired by the approved visual unification; bundle filenames and dependency-generated bytes are not the contract. Review selector changes and verify all three sections at desktop and mobile widths, in light/dark mode, including native fallbacks and recipe printing. `tailwind-sources` and `blog-css-sources` enforce the single entry, shared shell, scoped article styles and section-specific manifest ownership.

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
- **Tailwind sources are explicit.** `src/styles/main.css` is the single Tailwind entry for all sections. It imports `source(none)` and scans UI under `src/components`, `src/layouts`, `src/pages` and `src/lib`, including installed shadcn parts. Content-only `lib/blog`, `components/recipes` and `pages/recipes` are excluded; recipe controls currently use semantic CSS rather than utility strings. Add actual UI sources if that changes. Scanner and built CSS contracts check the source set, shared shell and scoped article rules. No duplicate blog theme or Tailwind entry.
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
(a retained runtime dependency; see `docs/legacy-redirects.md`), and `form-action 'self'`, which does not
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
