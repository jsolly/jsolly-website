## Ship

Ship profile: `vercel-static`

**Integration: branch → PR → merge on green `CI / ci`.** `/ship` merges per `skills/ship/references/git-discipline.md` → Merge a same-repo self PR (read the installed `/ship` reference). Agents never push to `main`, change rulesets, or admin-merge.

Production URL: <https://www.jsolly.com>

Production verification follows Vercel READY and the public navigation and Markdown behavior smoke.

Local gate before push: `npm run gate`.

## Purpose

Personal website at [jsolly.com](https://www.jsolly.com). Astro static site: the portfolio pages (`index`, `about`, `contact`, `privacy`, `terms`, `404`, `500`) plus the blog under `/blog/`, which is being ported from awesome-blog (`docs/plans/blogthedata-merge/`; B23 rewrites this section).

## Stack

Astro 7 with Svelte 5 islands, Tailwind CSS 4 (via `@tailwindcss/vite`), TypeScript, Biome 2 for lint/format, `@astrojs/sitemap` for generated sitemap. Inter + Poppins fonts via `@fontsource`. Node version pinned in `.nvmrc`.

## Frontend stack

Astro owns static pages; Svelte + shadcn-svelte owns interactive product UI.
Use the installed generated controls for new or replaced standard controls,
loading `/shadcn-svelte`. Navigation uses a hydrated Svelte island and the
hero/contact calls to action use server-rendered Button anchors. Preserve
native link semantics, first-party assets, the portfolio palette and focus.
`components.json` configures the pinned local CLI and existing Tailwind styles.
Reuse `src/lib/components/ui`; import defining component files directly.
The blog and recipe ports keep their awesome-blog native controls (the
`<details>` categories menu and the toggle/inert mobile disclosure, which work
without JavaScript through `no-script.css`, and the post cards' "Load more
posts" link, which `no-script.css` hides so the noscript archive link is the
way on, and the post page's "Print this post" button, share links, "Back to
home" link and heading-link copy script) for parity with live blogthedata.com under the approved merge plan
(J25), until the post-C4 visual unification follow-up; new blog and recipe
controls use shadcn-svelte. The recipe pages already use shadcn-svelte's
bits-ui parts (`dialog*`, `collapsible*`, `checkbox`, `native-select`,
`popover*` in `src/lib/components/ui/`), with native `<details>`, checkboxes
and a share link as the server-rendered no-JavaScript fallback; the recipe
library's controls need JavaScript, and without it `recipes-no-script.css`
leaves only the collection links and the cards, whose links open each recipe's
page.
Canon: `~/code/dotagents/rules/frontend-stack.md`.

## Dependencies / Assets

**No CDN for app assets.** Runtime CSS/JS (and app fonts) come from npm, local files, or same-origin build output. Do not load jsDelivr, unpkg, cdnjs, or similar CDNs at runtime.

## Commands

```bash
npm run dev                 # Astro dev server (localhost:4321)
npm run build               # astro build (writes the route manifest) + node process-html.mjs + built-CSP test (csp suite)
npm run build:maintenance   # MAINTENANCE_MODE=true npm run build (renders Maintenance.astro)
npm run preview             # Preview the production build locally
npm run check:fix           # biome check --write
npm run check:ts            # astro check + svelte-check (errors only)
npm run fix                 # check:fix + check:ts (combined)
npm test                    # unit tests: src/**/*.test.{ts,mjs} and scripts/unit/*.test.mjs
npm run test:built          # built-output tests: scripts/built/*.test.mjs against dist/ (run after build)
npm run redirects:write     # regenerate legacy/blogthedata/vercel.json from url-map.json
npm run redirects:check     # fail when legacy/blogthedata/vercel.json differs from what url-map.json generates
npm run recipes:sync        # regenerate public/recipes/data/recipe-library.{json,md} from recipes.json
npm run recipes:check       # fail when public/recipes/data differs from what recipes.json generates
```

Every suite runs through `scripts/run-tests.mjs`: `npm test` (`unit`), `npm run test:built` (`built`), the built-CSP check at the end of `npm run build` (`csp`) and `npm run smoke:scenario-contract` (`smoke`). It fails a suite when its passing-test count differs from `scripts/test-counts.json`. Update the count in the commit that adds tests; lower it only in a commit that names each dropped test.

A built test that needs its own build uses a `scripts/built/temp-copy.mjs` copy of the working tree, never the real tree; that file's header describes the isolation.

## Worktrees

`npm run worktree:init` runs `npm ci` in a fresh worktree. No `.worktreeinclude` is needed: the only gitignored source file, `src/generated/route-manifest.js`, is written by `npm run build`, and nothing before a build needs it. There is no gitignored runtime configuration or local state.

## Architecture

- `src/pages/` — content pages (`index`, `about`, `contact`, `privacy`, `terms`) plus `404` and `500`, and the `blog/` routes, which render with `BlogLayout`: `/blog/`, `/blog/all-posts/`, `/blog/category/<slug>/` (slug case kept, e.g. `Geodev`; the `category/` folder is Astro's routing layout), `/blog/works-cited/`, `/blog/search/` (noindex; the `Search` island reads `?searched=` and fetches the `/blog/search-index.json` endpoint, one entry per published post), one page per published post, `/blog/<slug>/` (`blog/[slug].astro`, slug case kept: breadcrumbs, related cards, share links and BlogPosting JSON-LD on jsolly.com URLs), and the `/blog/rss.xml` and `/blog/atom.xml` feed endpoints (the five most recently updated posts; BlogLayout links both as alternates, and `vercel.json` sends their Content-Types, which a static build cannot; `scripts/unit/vercel-feed-headers.test.mjs` routes both paths through Vercel's routing-utils). The `recipes/` routes render with `BlogLayout section="recipes"`: one page per recipe, `/recipes/<id>/` (`recipes/[slug].astro`, ids from `recipes.json`; the `RecipePage` island reads `?servings=` and `?starch=<id>:<side>` share links, and its section id is the recipe id, so old `#<id>` links land), and the recipe library: the landing `/recipes/` (`recipes/index.astro`, where blogthedata.com's Easy Meals & Smoothies post 301s; it renders the whole library, meals first, keeps the post's `#easy-meals--smoothies`, `#meal-results` and `#about-author` ids, and opens any `#<recipe-id>` in the library dialog) and `/recipes/meals/` and `/recipes/smoothies/` (`recipes/meals.astro` and `recipes/smoothies.astro` over `RecipeCollectionPage.astro`, the library opened on that collection). The library saves its settings as `{ servings, filters, appliancesOnHand, familyChoice }` (nothing else) in `localStorage` under `recipes-settings-v1` (J13).
- `src/components/` — `Header`, `Footer`, `ContactMe`, `SocialLinks`, `Maintenance`, plus a `home/` subdir for index-page sections and a `blog/` subdir for the blog chrome (`BlogNavigation`) and browse components (`PostCards`, the post card list with its load-more island, and `AuthorCard`, whose `h2#about-author` is a legacy fragment id), and `Search`, the search page island.
- `src/layouts/` — page layout wrappers: `Layout.astro` for the portfolio, `BlogLayout.astro` for the blog and recipes. BlogLayout is standalone (no Markdown alternate), honors `MAINTENANCE_MODE`, and with `section="blog"` adds the per-page `img-src` (CloudFront) and `frame-src` (YouTube, diagrams.net, nbviewer) CSP directives, failing the build when `Astro.csp` is unavailable.
- `src/styles/recipes/recipes-theme.css` — the recipe colours and recipe print rules, imported by recipe pages only; it and every recipe component `<style>` block open with the blog sheets' `@layer` order and sit in the `blog` layer. Its no-JavaScript companion, `recipes-no-script.css` (the `.recipe-experience` fallback rules, in the `blog-no-script` layer), is linked inside `<noscript>` by its only importer, `RecipeExperience.astro`.
- `src/styles/blog/` — the blog stylesheets BlogLayout imports (`theme`, `ui`, `blog`, and `no-script` through `?url`), each opening with the same `@layer` order so the `blog` and `blog-no-script` layers stay last.
- `src/content/` — Astro content collections, defined in `src/content.config.ts`.
- `.pages.yml` — the PagesCMS config. Media uploads land in `public/blog/media` and are served at `/blog/media`; the posts and categories collection paths are `POSTS_DIR` and `CATEGORIES_DIR` from `src/lib/blog/constants.ts`, which the content collections read too. `src/lib/blog/pages-config.test.ts` pins it to the collections and their schemas, and `scripts/built/blog-content-contracts.test.mjs` builds posts saved the PagesCMS way in a temp copy: their timestamps, preformatted text and `/blog/media` uploads survive, a draft reaches no built file, and bad timestamps, duplicate slugs and unknown `related` slugs fail the build.
- `src/lib/blog/` — blog lib: `post-loader.ts` (PagesCMS frontmatter loader, plus `postLastmods`, each post path's `updated` time for the sitemap, read at config load, so a bad post file fails the build there, named), `schemas.ts` (post and category schemas, plus `publishedContent` and `categoryCounts`, the pure checks, draft filter, orderings and category names over the loaded collections; the build fails on an empty article, a duplicate post or category slug, an unknown category or a `related` slug naming no post), `content.ts` (only the `getCollection` wiring: `blogContent` and `blogNavigation`), `cards.ts` (`cards`, the pure post card data `PostCards` renders: UTC date labels, the same-day updated rule, reading time; plus `dateLabel`), `urls.ts` (the blog URL builders `postHref` and `categoryHref`, slug case kept; dependency-free so client islands can import them without the sanitizer), `types.ts` (`Card`, `CardPost`, `FeedPost`, `LegacyRow`), `html.ts` (article sanitizer and heading ids), `feeds.ts` (the pure `rssFeed` and `atomFeed` builders, links on the Astro `site`, and `legacyFeedIds`, the pre-merge feed ids from `url-map.json` per J8; each feed's path, media type and alternate title live in `constants.ts` `FEEDS`, beside the feed title, description and unchanged Atom feed id), `search.ts` (search index parse and MiniSearch) and `constants.ts`.
- Recipes — `src/components/recipes/` holds the recipe data, `recipes.json` (21 recipes: 15 meals, 6 smoothies; images under `/recipes/media/`) and `nutrition-data.json` (the Daily Value nutrients and each recipe's per-ingredient nutrient rows), `constants.mjs` (`BASE_SERVINGS`, the disclaimer and leftovers text, the starch and appliance tables), and the pure recipe modules with their `*.test.mjs` unit tests: `recipe-logic.mjs` (settings, scaling, quantity and temperature display, per-serving and smoothie nutrition, package notes), `display-units.mjs` (metric cooking text), `nutrition.mjs` (Daily Values and recorded omega-3), `nutrient-filters.mjs` (library filters and appliance inventory), `trn-logic.mjs` (the Tabular Recipe Notation flow grid and its HTML) and `recipe-export.mjs` (the cooking document behind print and the assistant downloads). `scripts/recipes/sync-assistant-data.mjs` (`recipes:sync`, `recipes:check`) generates the assistant downloads `public/recipes/data/recipe-library.{json,md}` from `recipes.json`; they are committed, Biome and markdownlint skip them so their bytes stay generated, and the gate's `recipes:check` fails on drift. `public/recipes/media/` holds the recipe images. `scripts/unit/recipe-data.test.mjs` checks that every recipe image URL is a `/recipes/media/` file that exists, pins the Markdown library's heading structure, and checks that the drift check reports edited and missing downloads. The recipe page components live beside them: `RecipePage.svelte` (the page island), `RecipeBody`, `RecipeFlow` (the TRN table and its method dialog), `RecipePrint` (the print-only copy), `ShareRecipe`, `ApplianceIcon` and `NutrientDisclosure`, with `recipe-url.mjs` (share links and their parsing), `ingredient-icon.mjs` and `recipe-print-session.mjs`. The library is `RecipeExperience.astro` (the island and its no-JavaScript styles), `RecipeLibrary.svelte` (its state: saved settings, filtering, the shuffled cards, the dialog's history and printing), `LibraryControls.svelte` (collection links, servings, filters, appliances on hand and the nutrition filters), `RecipeCard.svelte`, `RecipeTakeover.svelte` (the full-screen recipe dialog), `RecipeBadge.svelte` (a card's or the dialog's group badge), `FilterMultiSelect.svelte` and `NutritionHelp.svelte`; `constants.mjs` also holds the library's storage key, `DEFAULT_FILTERS`, filter choices, nutrition thresholds and appliance limits, `nutrient-filters.mjs` `parseSavedSettings` (which validates every saved key, family sides against their recipe's sides), and `recipe-print-session.mjs` the Print buttons' print step for both islands. `scripts/built/recipes-built.test.mjs` checks the built recipe routes without JavaScript, `recipes-browse.test.mjs` browses them in Chromium (recipe pages with and without JavaScript and their share links, the filters and their saved settings, the collection pages without JavaScript and the nutrition help), `recipes-library.test.mjs` covers the library's printing, the dialog's history and saved settings that no longer fit or are malformed, and `recipes-deep-links.test.mjs` opens every old `/recipes/#<recipe-id>` link and `#meal-results` cold.
- `process-html.mjs` — post-build pass that adds slugified `id` attributes to id-less `h2/h3/h4` (for anchor links), except under `dist/blog/` and `dist/recipes/`, and runs `html-minifier`. Runs after every `astro build`. The minifier keeps the Svelte and Astro hydration comments and collapses whitespace conservatively, so islands hydrate in place instead of re-rendering; Svelte's `<!>` anchor that ends a `<select>` or `<option>` with snippet content, which the minifier cannot parse, is rewritten to the equivalent `<!---->` first. `scripts/built/hydration.test.mjs` pins that contract.
- `middleware.ts` — Vercel routing middleware (every path; no matcher). The same URL serves HTML or Markdown by `Accept` (`src/lib/accept-negotiate.ts`, `src/lib/agent-response.ts`, pages in `src/content/agent-pages.ts`): the five portfolio pages have Markdown variants and `.md` siblings, and any other path asked for as Markdown gets the Markdown 404 that `public/llms.txt` promises. Any path ending in a file extension other than `.md` is static and never negotiated or answered 406, and files under `/recipes/data/` are served as they are, `.md` included (an extensionless miss there keeps the Markdown 404). Real routes under `/blog/` and `/recipes/` serve HTML only (J11 in the merge plan), with no `Vary: Accept`; the percent-decoded path is looked up in the route manifest, and unknown paths there keep the Markdown 404.
- Route manifest — the `routeManifest` integration in `astro.config.ts` writes the gitignored `src/generated/route-manifest.js` from Astro's own `astro:build:done` page list (`export const routes = [...]`, one `/path/` per built page, `/` for the index, error pages excluded). `middleware.ts` imports it to tell real routes from unknown paths, and Vercel bundles the middleware after `npm run build`, so it ships that build's list. The tracked `route-manifest.d.ts` types the import, so `check:ts` and knip pass before any build. The lib functions take the route set as a parameter, so unit tests inject their own and never need the generated file.
- `legacy/blogthedata/` — the redirect-only static project for the old blog host (blogthedata.com, `www.blogthedata.com`, `blogthedata.vercel.app`), owned by this repo. It is the Root Directory of the separate Vercel project `blogthedata` and stays inert until John re-points that project here at cutover step C2 of the merge plan (decisions J1, J2). `url-map.json` is the source of truth: each row of known old paths 301s to `https://www.jsolly.com/...`, serves a file from `public/`, or stays 404 (the static `public/404.html`; no catch-all); rows of class `service-worker` also get the no-cache JavaScript headers. `url-union.json` records every known old path, its evidence and whether it is served 200 today. `vercel.json` is generated: edit `url-map.json` (and `url-union.json` when the edit adds a known path), run `npm run redirects:write`, and commit all three; the gate's `redirects:check` fails on drift. jsolly.com's build reads `url-map.json` too: a post with a `post` redirect row predates the merge, so `src/lib/blog/feeds.ts` keeps its old `https://www.blogthedata.com/post/<slug>/` feed guid and Atom id (J8). Adding or removing a post row changes that post's feed id, and subscribers see it again as a new item. `public/` holds only `404.html`, `robots.txt`, `.well-known/security.txt` and the two byte-identical kill-switch service workers (`recipe-service-worker.js` and `post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js`), which retire the old recipe workers and must stay as long as the host lives. `scripts/unit/blogthedata-redirects.test.mjs` compiles `vercel.json` with Vercel's `@vercel/routing-utils` and routes every row form and known path through it, including the ledger of paths served today that deliberately become 404 (decision J27), whose only home is that test's constants; `scripts/built/blogthedata-killswitch.test.mjs` proves the kill-switch in Chromium across two origins. Its `.well-known/security.txt` follows the site files policy below. `meta.freeze_sha` stays null until merge step C0 records the awesome-blog freeze SHA. `fragment-ids.json` holds the fragment ids each old page offered, generated from the awesome-blog build by `scripts/port/fragment-ids.mjs` (refreshed at C0); `scripts/built/legacy-fragments.test.mjs` checks that each page's 301 destination keeps them once its route is built.
- `docs/plans/` — archival planning records (the blogthedata merge plan bundle lives in `docs/plans/blogthedata-merge/`). Biome and markdownlint ignore it, and Tailwind does not scan it.
- `astro.config.ts` — site URL flips between `localhost:4321` (dev) and `https://www.jsolly.com` (prod) so the sitemap and absolute links resolve correctly per environment. It sets `trailingSlash: "always"` and `prerenderConflictBehavior: "error"`, and renders Markdown with the satteri processor and Prism highlighting (Shiki emits inline styles under the CSP). The `@astrojs/sitemap` options list every built page except the noindex `/blog/search/` (`filter`; the integration drops 404 and 500 itself; `/recipes/` pages are listed, J12) and give each post a `lastmod` from its frontmatter `updated` (`serialize`). The config reads those times once at load with `postLastmods` (`POSTS_DIR` and `POST_FILES` in `src/lib/blog/constants.ts`, shared with the collection loader), because the integration swallows a throw inside `serialize` and the build would pass without a sitemap. `scripts/built/blog-site-files.test.mjs` checks the built sitemap against the built pages' own robots meta and the post frontmatter.
- Site files — `public/robots.txt` disallows only `/blog/search/`; the legacy host's `robots.txt` disallows nothing, so crawlers follow its 301s. Both hosts' `.well-known/security.txt` (Contact `https://www.jsolly.com/contact/`, J15) carry no `Encryption`: `public/pgp-key.txt`, the old blog's key, expired on 2023-05-08 and stays only because the legacy `/pgp-key.txt` redirect (SEC-001) and two posts link to it. Re-add `Encryption` to both only after John publishes a current key. Both share one `Expires`, which must fall after HEAD's commit date and less than 365 days after it (in the pre-commit hook HEAD is the parent of the commit being made), so bump both together yearly. `scripts/site-files.mjs` holds the one parser and security.txt check; `scripts/unit/site-files.test.mjs` and `blogthedata-redirects.test.mjs` run it on both files and pin the shared `Expires`, and `scripts/built/blog-site-files.test.mjs` checks robots.txt and that the URLs they name are built.

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
- **Tailwind sources are explicit.** `src/styles/main.css` imports Tailwind with `source(none)` and lists its `@source` / `@source not` paths, so docs, data and blog or recipe code never change the portfolio bundle; Tailwind class strings must live in `src/components`, `src/layouts`, `src/pages` or `src/lib`. The blog paths (`lib/blog`, `components/blog`, `pages/blog`, `layouts/BlogLayout.astro`), the recipe paths (`components/recipes`, `pages/recipes`) and the shadcn-svelte parts in `lib/components/ui` are excluded from the portfolio sources, with `ui/button.svelte` re-included because the portfolio uses it. `scripts/unit/tailwind-sources.test.mjs` asks Tailwind's own scanner which files feed `main.css` and fails on any file outside those four roots or under an excluded path. The blog and recipes have their own Tailwind entry, `src/styles/blog/ui.css`, with its own `source(none)` and `@source` list (the ui parts and the blog navigation and search; recipe components use no Tailwind utilities of their own, so they need no source); each page loads one entry stylesheet, portfolio or blog, never both. `scripts/built/blog-css-sources.test.mjs` fails when a blog `@source` path is missing (Tailwind ignores it silently), when a blog or recipes stylesheet does not open with the shared `@layer` statement, or when the built BlogLayout bundle loses a pinned selector or loads the portfolio stylesheet.
- **Heading IDs are auto-generated** by `process-html.mjs` from heading text — don't hand-write `id="..."` on headings unless overriding the generated slug. Blog and recipe pages are excluded from that pass, and `scripts/unit/process-html-ids.test.mjs` pins the exclusion: `src/lib/blog/html.ts` owns the blog article heading ids, and recipe pages get no generated ids (their Svelte components render their headings). The recipe ids that exist are deliberate. On `/recipes/`, the h1's `#easy-meals--smoothies`, the card wrapper's `#meal-results` and the author card's `#about-author` are hand-written legacy-fragment ids from the old Easy Meals & Smoothies post, pinned by `scripts/built/legacy-fragments.test.mjs`. Each recipe's section id (on its page and in the library dialog) comes from its recipe id, and RecipeTakeover's `recipe-detail-title` exists only for `aria-labelledby`.

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
`img-src` directive.
`scripts/unit/vercel-csp-header.test.mjs` pins the full header directive map,
and the build-time `csp` suite checks every built `<img>` and `<source srcset>` URL against both policies.
`scripts/built/csp-browser.test.mjs` loads `/blog/`, posts with YouTube,
nbviewer and diagrams.net embeds, a `/blog/search/?searched=django` search
(the island parses its index with zod, whose JIT `search.ts` turns off),
`/about/`, a recipe page, `/recipes/greek-turkey-patties/`, with its
notation dialog opened (its island scripts and same-origin images, plus the
bits-ui dialog's inline styles under `style-src 'unsafe-inline'`),
`/recipes/meals/` with a filter and the nutrition help popovers opened and
`/recipes/#lemon-salmon-and-asparagus` with the library's recipe dialog open in Chromium with the header served on every response, and fails on
any `securitypolicyviolation`.
Astro lists every inline script hash of the build in each page's meta policy,
so an inline `<script>` on a blog page also adds its hash to the portfolio pages.
